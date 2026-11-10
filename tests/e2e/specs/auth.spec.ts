/** Sign-in, lockout and staff unlock, guest sign-up, sign-out and access control. */
import { test, expect, uiLogin } from "../fixtures";
import { createUser, one, auditRows, userByEmail, uniqueEmail, uniqueName, uniquePassword } from "../support/db";
import { t } from "../support/i18n";

async function submitLogin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/en/login");
  await page.locator("#le").fill(email);
  await page.locator("#lp").fill(password);
  await page.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await page.waitForURL(/\/en\/(login\?error=|my\/dashboard)/);
}

test("a wrong password shows a generic error @smoke", async ({ page }) => {
  const u = await createUser();
  await submitLogin(page, u.email, "Wrong-password-123");
  await expect(page).toHaveURL(/\/en\/login\?error=1/);
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("auth.invalid"));
  await expect(page.locator("#le")).toHaveAttribute("aria-invalid", "true");
  // Unknown accounts get exactly the same message (no account enumeration).
  await submitLogin(page, uniqueEmail(), "Wrong-password-123");
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("auth.invalid"));
});

test("an account locks after 5 failed attempts and an admin can unlock it", async ({ page, adminPage }) => {
  const u = await createUser();
  for (let i = 1; i <= 5; i++) {
    await submitLogin(page, u.email, `Wrong-password-${i}xx`);
    // Attempts 1–4: generic error. The 5th failure locks the account (it may already say so).
    const alert = page.locator("main").getByRole("alert");
    if (i < 5) await expect(alert).toHaveText(t("auth.invalid"));
    else expect([t("auth.invalid"), t("auth.locked")]).toContain(await alert.textContent());
  }
  const lock = await one<{ failures: number; lockedUntil: Date | null }>(`SELECT * FROM "LoginThrottle" WHERE key = $1`, [`e:${u.email}`]);
  expect(lock?.failures).toBeGreaterThanOrEqual(5);
  expect(lock?.lockedUntil && +lock.lockedUntil > Date.now()).toBeTruthy();
  expect((await auditRows({ action: "auth.login_failed", target: u.email })).length).toBeGreaterThanOrEqual(4);

  // Even the right password is refused while locked.
  await submitLogin(page, u.email, u.password);
  await expect(page).toHaveURL(/error=locked/);
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("auth.locked"));

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
  await expect(other).toHaveURL(/error=generic_account/);
  await expect(other.locator("main").getByRole("alert")).toHaveText(t("join.err_generic_account"));
  await other.locator("#sn").fill(name); await other.locator("#se").fill(uniqueEmail()); await other.locator("#sp").fill("password123!");
  await other.getByRole("button", { name: t("auth.createBtn") }).click();
  await expect(other).toHaveURL(/error=pw_common/);
  await expect(other.locator("main").getByRole("alert")).toHaveText(t("join.err_pw_common"));
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
