/** Sign-in (portal home per role), lockout and staff unlock, deactivated accounts, guest sign-up, sign-out, admin portal chrome and
 *  access control. */
import { test, expect, uiLogin, expectLoginRefused } from "../fixtures";
import { createUser, one, q, auditRows, userByEmail, uniqueEmail, uniqueName, uniquePassword } from "../support/db";
import { t, tFr, re } from "../support/i18n";

/** Submit the login form from a fresh /en/login. Callers assert the outcome: a refusal comes back as form state (an alert on
 *  /en/login, no ?error= redirect), a success navigates to the portal home (My membership, or Admin → Members for admins). */
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
  await expect(row.getByText(t("admin.locked"), { exact: true })).toBeVisible();
  await row.getByRole("button", { name: t("admin.unlock") }).click();
  await expect(adminPage).toHaveURL(/msg=unlocked/);
  await expect(adminPage.locator("main").getByRole("status")).toContainText(t("admin.unlocked"));
  expect(await one(`SELECT * FROM "LoginThrottle" WHERE key = $1`, [`e:${u.email}`])).toBeUndefined();
  expect(await auditRows({ action: "auth.account_unlocked", target: u.id })).toHaveLength(1);

  await submitLogin(page, u.email, u.password);
  await expect(page).toHaveURL(/\/en\/my\/billing$/);
});

test("a deactivated account gets the same error as a wrong password", async ({ page }) => {
  // Deactivation (User.active = false) is set through Admin → Users for admin accounts; the rule applies to every account.
  const u = await createUser();
  await q(`UPDATE "User" SET active = false WHERE id = $1`, [u.id]);
  // The right password: exactly the generic "wrong password" error (no hint that the account exists or is deactivated).
  await submitLogin(page, u.email, u.password);
  await expectLoginRefused(page, t("auth.invalid"), { email: u.email });
  await expect(page.locator("#le")).toHaveAttribute("aria-invalid", "true");
  expect(await auditRows({ action: "auth.login_blocked_inactive", target: u.email })).toHaveLength(1);
  // A wrong password reads the same.
  await submitLogin(page, u.email, "Wrong-password-123");
  await expectLoginRefused(page, t("auth.invalid"), { email: u.email });
  // A deactivated admin account too.
  const a = await createUser({ role: "admin" });
  await q(`UPDATE "User" SET active = false WHERE id = $1`, [a.id]);
  await submitLogin(page, a.email, a.password);
  await expectLoginRefused(page, t("auth.invalid"), { email: a.email });
  expect(await auditRows({ action: "auth.login_blocked_inactive", target: a.email })).toHaveLength(1);
  // Reactivated → the same password signs in again.
  await q(`UPDATE "User" SET active = true WHERE id = $1`, [u.id]);
  await submitLogin(page, u.email, u.password);
  await expect(page).toHaveURL(/\/en\/my\/billing$/);
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
  // New accounts land on My membership: welcomed by name, with no membership yet.
  await expect(page).toHaveURL(/\/en\/my\/billing(\?|$)/);
  await expect(page.locator("main#main h1")).toHaveText(t("member.billingPage.title"));
  await expect(page.locator(".app-head")).toContainText(name);
  await expect(page.locator("section[aria-labelledby=h-status]")).toContainText(t("member.billingPage.st_none"));
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
  await expect(p.locator(".header-cta").getByRole("link", { name: t("chrome.myAdaig") })).toHaveCount(0);
  for (const path of ["/en/my/billing", "/en/my/dashboard"]) {
    await p.goto(path);
    await expect(p, path).toHaveURL(/\/en\/login/);
  }
});

const MEMBER_MENU = ["member.billing", "member.profile", "member.events", "member.community", "member.directory"];
/** The admin sidebar of a Super Admin (round 7: one entry per module the role can view, in this order; Content was removed). */
const ADMIN_MENU = ["adminNav.members", "adminNav.events", "adminNav.messages", "adminNav.users", "adminNav.roles"];

test("admins sign in to Admin → Members, inside the minimal admin portal chrome @smoke", async ({ loginAs, isMobile }) => {
  const u = await createUser({ role: "admin" }); // an admin created this way is a Super Admin (support/db.ts)
  const p = await loginAs(u, { expectUrl: /\/en\/admin\/members$/ });
  await expect(p.locator("main#main h1").first()).toBeVisible();
  // Admin header: logo → admin home only. The profile menu (avatar + name → Profile & privacy, Sign out) sits at the bottom of the
  // admin sidebar on desktop, and at the bottom of the "Admin menu" panel on phones. No public chrome.
  const header = p.locator("header.admin-header");
  await expect(header).toBeVisible();
  await expect(header.locator("a.admin-header__brand")).toHaveAttribute("href", "/en/admin/members");
  await expect(header.locator("details, .avatar")).toHaveCount(0);
  if (isMobile) {
    await p.locator("details.adm-mnav > summary").click();
    const me = p.locator(".adm-mnav .adm-mnav-profile");
    await expect(me).toContainText(u.name);
    await expect(me.getByRole("link", { name: t("adminNav.profile") })).toHaveAttribute("href", "/en/my/profile");
    await p.locator("details.adm-mnav > summary").click(); // close it again
  } else {
    const profile = p.locator(".adm-side details.adm-profile");
    await expect(profile.locator("summary")).toContainText(u.name);
    // pinned to the bottom of the sidebar column, which runs to the bottom of the window (fixed app sidebar)
    const [side, prof] = await Promise.all([p.locator(".adm-side").boundingBox(), profile.boundingBox()]);
    expect(Math.abs(side!.y + side!.height - (prof!.y + prof!.height))).toBeLessThan(24);
    expect(Math.abs(p.viewportSize()!.height - (prof!.y + prof!.height))).toBeLessThan(24);
    await profile.locator("summary").click();
    await expect(profile.getByRole("link", { name: t("adminNav.profile") })).toHaveAttribute("href", "/en/my/profile");
    await expect(profile.getByRole("button", { name: t("chrome.signOut") })).toBeVisible();
    await profile.locator("summary").click(); // close it again
    await expect(profile).not.toHaveAttribute("open", "");
  }
  for (const sel of [".site-header", ".util", "#primary-nav", ".site-footer"]) await expect(p.locator(sel), sel).toHaveCount(0);
  await expect(p.getByRole("navigation", { name: t("chrome.langAria"), exact: true })).toHaveCount(0);
  await expect(p.locator("footer.admin-footer")).toBeAttached();
  // Admin menu: a Super Admin sees every module (Members, Events, Messages, Users, Roles), nothing else (sidebar on desktop,
  // "Admin menu" disclosure on phones). Other roles: see rbac.spec.ts.
  const menu = isMobile ? p.locator("nav.adm-mnav-wrap .adm-mnav-links") : p.locator("nav.adm-sidenav"); // the panel's profile block sits after the links
  if (isMobile) await p.locator("details.adm-mnav > summary").click();
  await expect(menu.locator("a")).toHaveText(ADMIN_MENU.map((k) => re(t(k))));
  await expect(menu.getByRole("link", { name: t("adminNav.members") })).toHaveAttribute("aria-current", "page");
  // Sign out: only in the profile menu (desktop: the dropdown checked above; the sidebar nav has none) and, on phones, as the last
  // item of the panel's profile block.
  if (isMobile) await expect(p.locator("nav.adm-mnav-wrap .adm-mnav-profile .sidenav-signout button")).toHaveText(t("chrome.signOut"));
  else await expect(menu.locator(".sidenav-signout")).toHaveCount(0);
  // Pages no longer in the menu still load by URL for admins.
  for (const path of ["dashboard", "settings", "audit", "system", "corporate", "chapter"]) {
    const r = await p.goto(`/en/admin/${path}`);
    expect(r?.status(), path).toBe(200);
    await expect(p, path).toHaveURL(new RegExp(`/en/admin/${path}$`));
    await expect(p.locator("main#main h1").first(), path).toBeVisible();
    await expect(p.locator("header.admin-header"), path).toBeVisible();
  }
  // Public pages: the account link goes to the admin home; there is no separate "Admin" button.
  await p.goto("/en");
  await expect(p.locator(".site-header")).toBeVisible();
  await expect(p.locator("header.admin-header")).toHaveCount(0);
  // (On phones the header buttons sit in the closed menu, hence includeHidden.)
  const siteHeader = p.locator(".site-header");
  for (const link of await siteHeader.getByRole("link", { name: t("chrome.myAdaig"), includeHidden: true }).all()) await expect(link).toHaveAttribute("href", "/en/admin/members");
  await expect(siteHeader.getByRole("link", { name: t("chrome.myAdaig"), includeHidden: true }).first()).toBeAttached();
  await expect(siteHeader.getByRole("link", { name: t("chrome.admin"), exact: true, includeHidden: true })).toHaveCount(0);
  await expect(p.locator(`a[href="/en/admin/dashboard"]`)).toHaveCount(0);
});

test("members sign in to My membership; the member menu lists the five member pages", async ({ loginAs }) => {
  const u = await createUser();
  const p = await loginAs(u, { expectUrl: /\/en\/my\/billing$/ });
  await expect(p.locator("main#main h1")).toHaveText(t("member.billingPage.title"));
  await expect(p.locator(".app-head")).toContainText(u.name);
  const nav = p.getByRole("navigation", { name: t("member.navAria") });
  await expect(nav.locator("a")).toHaveText(MEMBER_MENU.map((k) => re(t(k))));
  await expect(nav.getByRole("link", { name: t("member.billing") })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator(".sidenav-signout button")).toHaveText(t("chrome.signOut"));
  await expect(nav.locator(`a[href="/en/my/dashboard"], a[href="/en/resources"]`)).toHaveCount(0);
  // Public header: the account link goes to My membership; no "Admin" button.
  await p.goto("/en/events");
  // (On phones the header buttons sit in the closed menu, hence includeHidden.)
  const siteHeader = p.locator(".site-header");
  for (const link of await siteHeader.getByRole("link", { name: t("chrome.myAdaig"), includeHidden: true }).all()) await expect(link).toHaveAttribute("href", "/en/my/billing");
  await expect(siteHeader.getByRole("link", { name: t("chrome.myAdaig"), includeHidden: true }).first()).toBeAttached();
  await expect(siteHeader.getByRole("link", { name: t("chrome.admin"), exact: true, includeHidden: true })).toHaveCount(0);
  // French: same landing, French copy.
  const fr = await loginAs(await createUser(), { locale: "fr", expectUrl: /\/fr\/my\/billing$/ });
  await expect(fr.locator("main#main h1")).toHaveText(tFr("member.billingPage.title"));
});

test("a safe next path still wins over the portal home", async ({ page }) => {
  const u = await createUser({ role: "admin" });
  await page.goto("/en/my/profile");
  await expect(page).toHaveURL(/\/en\/login\?/);
  await page.locator("#le").fill(u.email);
  await page.locator("#lp").fill(u.password);
  await page.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expect(page).toHaveURL(/\/en\/my\/profile$/);
});

test.describe("access control", () => {
  test("visitors are sent to sign in from member and admin pages", async ({ page }) => {
    for (const path of ["/en/my/dashboard", "/en/my/billing", "/en/my/profile", "/en/my/directory", "/en/admin/dashboard", "/en/admin/members", "/en/admin/settings", "/en/admin/users", "/en/admin/roles", "/fr/admin/system"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(new RegExp(`/${path.slice(1, 3)}/login`));
    }
  });

  test("members and guests are sent from admin pages to My membership", async ({ memberPage, guestPage }) => {
    for (const p of [memberPage, guestPage]) {
      // (/en/admin/content was removed in round 7: it is a 404 now, see admin-ops.spec.ts.)
      for (const path of ["/en/admin/dashboard", "/en/admin/members", "/en/admin/events", "/en/admin/users", "/en/admin/roles", "/en/admin/no-access", "/en/admin/audit", "/en/admin/corporate", "/fr/admin/messages"]) {
        await p.goto(path);
        await expect(p, path).toHaveURL(new RegExp(`/${path.slice(1, 3)}/my/billing$`));
        await expect(p.locator("header.admin-header"), path).toHaveCount(0); // never the admin chrome
      }
    }
  });

  test("the seed member can sign in through the form @smoke", async ({ page }) => {
    await uiLogin(page, { email: "member@adaig.test", password: process.env.E2E_SEED_PASSWORD || "Password123!" }, { expectUrl: /\/en\/my\/billing$/ });
    await expect(page.locator(".sidenav")).toBeVisible();
  });
});
