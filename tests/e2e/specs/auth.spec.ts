/** Sign-in, lockout and staff unlock, guest sign-up, sign-out and access control. */
import { test, expect, uiLogin, expectLoginRefused } from "../fixtures";
import { createUser, one, auditRows, userByEmail, uniqueEmail, uniqueName, uniquePassword } from "../support/db";
import { t, re } from "../support/i18n";

/** Submit the login form from a fresh /en/login. Callers assert the outcome: a refusal comes back as form state (an alert on
 *  /en/login, no ?error= redirect), a success navigates to the dashboard. */
async function submitLogin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/en/login");
  await page.locator("#le").fill(email);
  await page.locator("#lp").fill(password);
  await page.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
}

test("a wrong password shows a generic error @smoke", async ({ page }) => {
  const u = await createUser();
  await submitLogin(page, u.email, "Wrong-password-123");
  await expectLoginRefused(page, t("auth.invalid"), { email: u.email }); // focused alert, email kept, password cleared
  await expect(page.locator("#le")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#le")).toHaveAttribute("aria-describedby", "login-err");
  // Unknown accounts get exactly the same message (no account enumeration).
  const unknown = uniqueEmail();
  await submitLogin(page, unknown, "Wrong-password-123");
  await expectLoginRefused(page, t("auth.invalid"), { email: unknown });
});

test("an account locks after 5 failed attempts and an admin can unlock it", async ({ page, adminPage }) => {
  const u = await createUser();
  for (let i = 1; i <= 5; i++) {
    await submitLogin(page, u.email, `Wrong-password-${i}xx`);
    // Attempts 1–4: generic error. The 5th failure locks the account (it may already say so).
    const alert = page.locator("main").getByRole("alert");
    if (i < 5) await expectLoginRefused(page, t("auth.invalid"));
    else await expect(alert).toHaveText(new RegExp(`^(${re(t("auth.invalid")).source}|${re(t("auth.locked")).source})$`));
  }
  const lock = await one<{ failures: number; lockedUntil: Date | null }>(`SELECT * FROM "LoginThrottle" WHERE key = $1`, [`e:${u.email}`]);
  expect(lock?.failures).toBeGreaterThanOrEqual(5);
  expect(lock?.lockedUntil && +lock.lockedUntil > Date.now()).toBeTruthy();
  expect((await auditRows({ action: "auth.login_failed", target: u.email })).length).toBeGreaterThanOrEqual(4);

  // Even the right password is refused while locked.
  await submitLogin(page, u.email, u.password);
  await expectLoginRefused(page, t("auth.locked"), { email: u.email });

  // Admin → Members shows the lock and clears it.
  await adminPage.goto(`/en/admin/members?q=${encodeURIComponent(u.email)}`);
  const row = adminPage.locator("tbody tr", { hasText: u.email });
  await expect(row.locator(".badge-red", { hasText: t("admin.locked") })).toBeVisible();
  await row.getByRole("button", { name: t("admin.unlock") }).click();
  await expect(adminPage).toHaveURL(/msg=unlocked/);
  await expect(adminPage.locator("main").getByRole("status")).toContainText(t("admin.unlocked"));
  expect(await one(`SELECT * FROM "LoginThrottle" WHERE key = $1`, [`e:${u.email}`])).toBeUndefined();
  expect(await auditRows({ action: "auth.account_unlocked", target: u.id })).toHaveLength(1);

  await submitLogin(page, u.email, u.password);
  await expect(page).toHaveURL(/\/en\/my\/dashboard/);
});

test("sign-up creates a free guest account", async ({ page, newPage }) => {
  const email = uniqueEmail(); const password = uniquePassword(); const name = uniqueName("Guest");
  await page.goto("/en/signup");
  await expect(page.locator("h1")).toHaveText(t("auth.signupTitle"));
  await page.locator("#sn").fill(name);
  await page.locator("#se").fill(email);
  await page.locator("#sp").fill(password);
  await page.locator("input[name=marketingOptIn]").check();
  await page.getByRole("button", { name: t("auth.createBtn") }).click();
  await expect(page).toHaveURL(/\/en\/my\/dashboard/);
  await expect(page.locator("h1")).toHaveText(name);
  await expect(page.locator(".mbr-alerts")).toContainText(t("dash.none"));
  const u = await userByEmail(email);
  expect(u).toMatchObject({ role: "guest", name, marketingOptIn: true, locale: "en", country: "United States" });
  expect(u!.passwordHash).toMatch(/^\$2[aby]\$/);

  // The same email again gets the generic account error (no enumeration); weak passwords are refused.
  const other = await newPage();
  await other.goto("/en/signup");
  await other.locator("#sn").fill(name); await other.locator("#se").fill(email); await other.locator("#sp").fill(uniquePassword());
  await other.getByRole("button", { name: t("auth.createBtn") }).click();
  // Errors come back as form state: same URL, focused alert, name/email kept, password cleared.
  const otherAlert = other.locator("main").getByRole("alert");
  await expect(otherAlert).toHaveText(t("join.err_generic_account"));
  await expect(otherAlert).toBeFocused();
  await expect(other).toHaveURL(/\/en\/signup$/);
  await expect(other.locator("#sn")).toHaveValue(name);
  await expect(other.locator("#se")).toHaveValue(email);
  await expect(other.locator("#sp")).toHaveValue("");
  await other.locator("#sn").fill(name); await other.locator("#se").fill(uniqueEmail()); await other.locator("#sp").fill("password123!");
  await other.getByRole("button", { name: t("auth.createBtn") }).click();
  await expect(otherAlert).toHaveText(t("join.err_pw_common"));
  await expect(other.locator("#sp")).toHaveAttribute("aria-invalid", "true");
  await expect(other).toHaveURL(/\/en\/signup$/);
});

test("sign out ends the session", async ({ loginAs }) => {
  const u = await createUser();
  const p = await loginAs(u);
  await p.locator(".sidenav-signout").getByRole("button", { name: t("chrome.signOut") }).click();
  await expect(p).toHaveURL(/\/en$/);
  await expect(p.locator(".header-cta").getByRole("link", { name: t("chrome.signIn") })).toBeVisible();
  await p.goto("/en/my/dashboard");
  await expect(p).toHaveURL(/\/en\/login/);
});

test.describe("access control", () => {
  test("visitors are sent to sign in from member and admin pages", async ({ page }) => {
    for (const path of ["/en/my/dashboard", "/en/my/profile", "/en/my/directory", "/en/admin/dashboard", "/en/admin/members", "/en/admin/settings", "/fr/admin/system"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(new RegExp(`/${path.slice(1, 3)}/login`));
    }
  });

  test("members and guests are sent from admin pages to their dashboard", async ({ memberPage, guestPage }) => {
    for (const p of [memberPage, guestPage]) {
      for (const path of ["/en/admin/dashboard", "/en/admin/members", "/en/admin/events", "/en/admin/content", "/en/admin/audit", "/en/admin/corporate"]) {
        await p.goto(path);
        await expect(p, path).toHaveURL(/\/en\/my\/dashboard/);
      }
    }
  });

  test("the seed member can sign in through the form @smoke", async ({ page }) => {
    await uiLogin(page, { email: "member@adaig.test", password: process.env.E2E_SEED_PASSWORD || "Password123!" });
    await expect(page.locator(".sidenav")).toBeVisible();
  });
});
