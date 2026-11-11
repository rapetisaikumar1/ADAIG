/**
 * Admin → Members: account page (profile, tier, renewal, lapse/reactivate, grant, CPE ledger, temporary password +
 * session invalidation, delete), new account, separation from Admin Portal accounts (round 7), members CSV.
 * Admin Portal accounts (role admin) are managed only in Admin → Users: see admin-users.spec.ts for creating them, role changes,
 * and the last-Super-Admin and self protections that used to live here.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect, uiLogin, expectLoginRefused, membershipCard } from "../fixtures";
import { auditRows, createMember, createUser, etDay, membershipsOf, one, userByEmail, userById, uniqueEmail, uniqueName, uniquePassword, RUN } from "../support/db";
import { SEED } from "../support/env";
import { t } from "../support/i18n";

const tm = (k: string, v?: Record<string, string | number>) => t(`adminMembers.${k}`, v);
const account = (p: Page, id: string) => p.goto(`/en/admin/members/${id}`);
const notice = (p: Page) => p.locator("main .alert").first();
/** The "Temporary password" form on the account page. */
const pwForm = (p: Page) => p.getByRole("form", { name: tm("pwTitle") });
const openDetails = (p: Page, scope: string, summary: string) => p.locator(`${scope} summary`, { hasText: summary }).click();

test("account page: edit the profile (email, country, state, flags)", async ({ adminPage: p }) => {
  const u = await createUser({ locale: "fr" }); // stored preference: kept on save (no language choice since round 6b)
  const newEmail = uniqueEmail(); const name = uniqueName("Edited");
  await account(p, u.id);
  await expect(p.getByRole("heading", { level: 1 })).toHaveAccessibleName(u.name); // the initials avatar beside it is aria-hidden
  await p.locator("#p-name").fill(name);
  await p.locator("#p-email").fill(newEmail.toUpperCase());
  await p.locator("#p-org").fill("E2E Edited Org");
  await p.locator("#p-job").fill("E2E Chief Records Officer");
  await p.locator("#p-country").selectOption("Canada");
  await p.locator("#p-prov").selectOption("ON");
  await expect(p.locator("#p-lang, select[name=prefLocale]")).toHaveCount(0); // French is not offered since round 6b
  await p.locator("#profile input[name=directoryOptIn]").check();
  await p.getByRole("button", { name: tm("saveProfile") }).click();
  await expect(p).toHaveURL(/msg=msg_profileSaved/);
  await expect(notice(p)).toHaveText(tm("msg_profileSaved"));
  expect(await userById(u.id)).toMatchObject({ name, email: newEmail, organisation: "E2E Edited Org", jobTitle: "E2E Chief Records Officer", country: "Canada", province: "ON", locale: "fr", directoryOptIn: true });
  expect(await auditRows({ action: "admin.email_changed", target: u.id })).toHaveLength(1);
  // A state that does not belong to the country is refused (the form only offers matching ones; forge the pair).
  await p.locator("#p-country").selectOption("United Kingdom");
  await expect(p.locator("#p-prov")).toBeDisabled();
  await p.locator("#p-prov").evaluate((el) => { const s = el as HTMLSelectElement; s.disabled = false; s.innerHTML = '<option value="ON" selected>ON</option>'; });
  await p.getByRole("button", { name: tm("saveProfile") }).click();
  await expect(p).toHaveURL(/msg=err_province/);
  expect((await userById(u.id))!.country).toBe("Canada");
});

test("memberships: change tier, renewal date, lapse and reactivate", async ({ adminPage: p }) => {
  const m = await createMember();
  await account(p, m.id);
  // Change tier.
  await openDetails(p, "#memberships", tm("changeTier"));
  await p.locator(`#ti-${m.membershipId}`).selectOption("public-sector");
  await p.locator("#memberships details[open]").getByRole("button", { name: tm("saveTier") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  expect((await membershipsOf(m.id))[0].tierId).toBe("public-sector");
  await expect(p.locator("#memberships")).toContainText("Public sector / NFP");

  // Renewal date (entered as an ET day, stored as noon ET).
  const day = etDay(new Date(Date.now() + 200 * 864e5));
  await account(p, m.id);
  await openDetails(p, "#memberships", tm("renewal"));
  await p.locator(`#rn-${m.membershipId}`).fill(day);
  await p.getByRole("button", { name: tm("saveRenewal") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  const [r] = await membershipsOf(m.id);
  expect(etDay(r.renewsAt!)).toBe(day);
  expect(await auditRows({ action: "membership.renewal_changed", target: m.membershipId })).toHaveLength(1);

  // Lapse → role back to guest; reactivate → active member again.
  await account(p, m.id);
  await openDetails(p, "#memberships", tm("markLapsed"));
  await p.locator("#memberships details[open] input[name=confirm]").check();
  await p.getByRole("button", { name: tm("markLapsedYes") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  expect((await membershipsOf(m.id))[0]).toMatchObject({ status: "lapsed", activeSlot: null });
  expect((await userById(m.id))!.role).toBe("guest");

  await account(p, m.id);
  await openDetails(p, "#memberships", tm("reactivate"));
  await p.getByRole("button", { name: tm("reactivateYes") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  expect((await membershipsOf(m.id))[0]).toMatchObject({ status: "active", activeSlot: m.id });
  expect((await userById(m.id))!.role).toBe("member");
});

test("grant a membership to an account without one", async ({ adminPage: p }) => {
  const u = await createUser();
  await account(p, u.id);
  await p.locator("#g-tier").selectOption("retired");
  await p.getByRole("button", { name: tm("grantButton") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipAdded/);
  const [m] = await membershipsOf(u.id);
  expect(m).toMatchObject({ tierId: "retired", status: "active" });
  expect((await userById(u.id))!.role).toBe("member");
  await expect(p.locator("#g-tier")).toHaveCount(0); // an open membership hides the grant form
});

test("CPE ledger: add and remove an entry", async ({ adminPage: p }) => {
  const m = await createMember();
  const title = `E2E CPE ${RUN} ${Math.random().toString(36).slice(2, 6)}`;
  await account(p, m.id);
  await p.locator("#c-title").fill(title);
  await p.locator("#c-hours").fill("2.5");
  await p.locator("#c-status").selectOption("approved");
  await p.getByRole("button", { name: tm("cpeAdd") }).click();
  await expect(p).toHaveURL(/msg=msg_cpeAdded/);
  const row = p.locator("#cpe tbody tr", { hasText: title });
  await expect(row).toContainText("2.5");
  await expect(p.locator("#cpe").getByText(tm("cpeTotal", { n: 2.5 }), { exact: true })).toBeVisible();
  const entry = await one<{ id: string; hours: number; status: string; createdBy: string }>(`SELECT * FROM "CpeEntry" WHERE "userId" = $1 AND title = $2`, [m.id, title]);
  expect(entry).toMatchObject({ hours: 2.5, status: "approved" });
  expect(entry!.createdBy).toBeTruthy();

  await p.locator(`#cpe summary[aria-label="${tm("cpeRemove")}: ${title}"]`).click();
  await p.locator("#cpe details[open]").getByRole("button", { name: tm("cpeRemoveYes") }).click();
  await expect(p).toHaveURL(/msg=msg_cpeRemoved/);
  await expect(p.locator("#cpe tbody tr", { hasText: title })).toHaveCount(0);
  expect(await one(`SELECT id FROM "CpeEntry" WHERE id = $1`, [entry!.id])).toBeUndefined();
});

test("temporary password: the old session is signed out and only the new password works", async ({ adminPage: p, loginAs, newPage }) => {
  const u = await createMember();
  const session = await loginAs(u);
  const newPassword = uniquePassword();
  await account(p, u.id);
  await p.locator("#pw-new").fill(newPassword);
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(pwForm(p).getByRole("status")).toContainText(tm("pwSet"));
  await expect(pwForm(p).getByRole("status").locator("code")).toHaveText(newPassword);
  expect(p.url()).not.toContain(newPassword);
  expect((await userById(u.id))!.sessionVersion).toBe(1);
  const audit = await auditRows({ action: "admin.password_reset", target: u.id });
  expect(audit).toHaveLength(1);

  // The member's existing session no longer works.
  await session.goto("/en/my/dashboard");
  await expect(session).toHaveURL(/\/en\/login/);
  // Old password refused, new password accepted.
  const fresh = await newPage();
  await fresh.goto("/en/login");
  await fresh.locator("#le").fill(u.email); await fresh.locator("#lp").fill(u.password);
  await fresh.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(fresh, t("auth.invalid"), { email: u.email });
  await uiLogin(fresh, { email: u.email, password: newPassword }, { expectUrl: /\/en\/my\/billing$/ });
  await expect(fresh.locator(".app-head")).toContainText(u.name);
});

test("generated temporary password and weak typed passwords", async ({ adminPage: p }) => {
  const u = await createUser();
  await account(p, u.id);
  await p.locator("#pw-new").fill("password123!");
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(pwForm(p).getByRole("alert")).toHaveText(tm("err_pw_common"));
  expect((await userById(u.id))!.sessionVersion).toBe(0);
  await p.locator("#pw-new").fill("");
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(pwForm(p).getByRole("status").locator("code")).toHaveText(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
});

test("new account with a generated password and a membership", async ({ adminPage: p, newPage }) => {
  const email = uniqueEmail(); const name = uniqueName("Created");
  await p.goto("/en/admin/members/new");
  await p.locator("#n-name").fill(name);
  await p.locator("#n-email").fill(email);
  await p.locator("#n-org").fill("E2E Offline Org");
  await p.locator("#n-prov").selectOption("NY");
  await expect(p.locator("#n-role")).toHaveCount(0); // no role choice (round 7): member comes from the membership below, admins from Users
  await p.locator("#n-tier").selectOption("professional");
  await p.locator("main form").getByRole("button", { name: tm("createButton") }).click();
  await expect(p.locator("main .alert-success")).toContainText(tm("createdTitle", { name }));
  const password = (await p.locator("main .alert-success").locator("code").textContent())!.trim();
  expect(password.length).toBeGreaterThanOrEqual(12);
  const u = await userByEmail(email);
  expect(u).toMatchObject({ name, role: "member", organisation: "E2E Offline Org", province: "NY" });
  expect((await membershipsOf(u!.id))[0]).toMatchObject({ status: "active", tierId: "professional" });
  expect(await auditRows({ action: "admin.account_created", target: u!.id })).toHaveLength(1);
  // Duplicate email is refused.
  await p.goto("/en/admin/members/new");
  await p.locator("#n-name").fill(name); await p.locator("#n-email").fill(email);
  await p.locator("main form").getByRole("button", { name: tm("createButton") }).click();
  await expect(p.locator("main .alert-danger")).toHaveText(tm("err_emailTaken"));
  // The generated password works.
  const s = await newPage();
  await uiLogin(s, { email, password }, { expectUrl: /\/en\/my\/billing$/ });
  await expect(membershipCard(s)).toContainText("Professional");
});

test("delete an account (anonymized, financial records kept)", async ({ adminPage: p }) => {
  const m = await createMember();
  await account(p, m.id);
  await p.locator("#delete input[name=confirm]").check();
  await p.getByRole("button", { name: tm("deleteButton") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/members\?msg=accountDeleted/);
  await expect(notice(p)).toHaveText(tm("list_accountDeleted"));
  expect(await userById(m.id)).toMatchObject({ role: "deleted", email: `deleted-${m.id}@deleted.invalid`, name: "Deleted member" });
  expect((await membershipsOf(m.id))[0].status).toBe("cancelled");
  expect(await auditRows({ action: "account.deleted_by_admin", target: m.id })).toHaveLength(1);
  // The deleted account is no longer listed; its page shows the deleted notice only.
  await p.goto(`/en/admin/members?q=${encodeURIComponent(m.email)}`);
  await expect(p.locator("tbody tr", { hasText: m.email })).toHaveCount(0);
  await account(p, m.id);
  await expect(p.locator("main")).toContainText(tm("deletedTitle"));
  await expect(p.locator("#delete")).toHaveCount(0);
});

// Removed in round 7: "make admin and remove admin from the members list" (Make admin / Remove admin are gone from Members; admin
// accounts are created and re-roled only in Admin → Users, covered by admin-users.spec.ts) and "last-admin and self protections"
// (the self and last-Super-Admin rules now apply in Admin → Users and /my/profile: see the self-protection and last-active-Super-Admin
// tests in admin-users.spec.ts).
test("members never shows admin accounts and Members actions refuse admin targets", async ({ adminPage: p }) => {
  // Target: a throwaway Super Admin (not the signed-in one, so only the separation rule can refuse, never the "self" rules; and a
  // failure can't damage a seed account the shared sessions depend on).
  const admin = (await userById((await createUser({ role: "admin", jobTitle: "E2E Staff" })).id))!;
  expect(admin.role).toBe("admin");
  for (const email of [admin.email, SEED.admin, SEED.admin2]) {
    await p.goto(`/en/admin/members?q=${encodeURIComponent(email)}`);
    await expect(p.locator("tbody tr", { hasText: email }), email).toHaveCount(0);
  }

  // Forged: another account's forms re-pointed at the admin's id are refused like a missing account; nothing changes.
  const other = await createUser();
  const repoint = (form: Locator) => form.evaluate((f, id) => { (f.querySelector("input[name=uid]") as HTMLInputElement).value = id; }, admin.id);
  await account(p, other.id);
  await p.locator("#p-job").fill(`E2E Forged ${RUN}`);
  await repoint(p.locator("#profile"));
  await p.getByRole("button", { name: tm("saveProfile") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/members\?msg=notFound/);
  await expect(notice(p)).toHaveText(tm("list_notFound"));

  await account(p, other.id);
  await repoint(p.locator("#delete"));
  await p.locator("#delete input[name=confirm]").check();
  await p.getByRole("button", { name: tm("deleteButton") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/members\?msg=notFound/);

  await account(p, other.id);
  await repoint(pwForm(p));
  await p.locator("#pw-new").fill(uniquePassword());
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(pwForm(p).getByRole("alert")).toHaveText(tm("err_notFound"));
  await expect(pwForm(p).locator("code")).toHaveCount(0); // no password was set

  expect(await userById(admin.id)).toMatchObject({ role: "admin", email: admin.email, name: admin.name, jobTitle: admin.jobTitle, passwordHash: admin.passwordHash, sessionVersion: admin.sessionVersion, deletedAt: null });
  for (const action of ["admin.profile_updated", "account.deleted_by_admin", "admin.password_reset"])
    expect(await auditRows({ action, target: admin.id }), action).toHaveLength(0);
  expect(await userById(other.id)).toMatchObject({ role: "guest", jobTitle: null, sessionVersion: 0 }); // the form's own account is untouched too
});

test("members CSV: admin only, neutralizes spreadsheet formulas", async ({ adminPage: p }) => {
  const u = await createUser({ name: `=HYPERLINK("http://evil.example") E2E ${RUN}` });
  const r = await p.request.get("/api/admin/members.csv");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("text/csv");
  expect(r.headers()["cache-control"]).toContain("no-store");
  const body = await r.text();
  expect(body.split("\n")[0]).toContain('"name","email","role"');
  const line = body.split("\n").find((l) => l.includes(u.email))!;
  expect(line).toBeTruthy();
  expect(line.startsWith(`"'=HYPERLINK(`)).toBe(true);
  expect(body).not.toMatch(/passwordHash|\$2[aby]\$/);
  // Admin Portal accounts are not listed in Members, so not exported either (round 7): only guest and member rows.
  expect(body).not.toContain(SEED.admin);
  expect(body).not.toContain(SEED.admin2);
  const roles = body.split("\n").slice(1).filter(Boolean).map((l) => /^"(?:[^"]|"")*","(?:[^"]|"")*","([^"]*)"/.exec(l)?.[1]);
  expect(roles.length).toBeGreaterThan(0);
  expect(roles.filter((r) => r !== "guest" && r !== "member")).toEqual([]);
});
