/**
 * Admin → Users (round 7, SPEC_R7 §5 / §9.2): Admin Portal accounts only. Direct creation (no invitation, usable right away),
 * list + search + status tabs + role filter, validation and email uniqueness across every account, editing details, role change
 * (next request), deactivate / reactivate, password reset by an authorized admin, unlock, self / last-Super-Admin / more-powerful-
 * user protections (UI and forged forms), separation from Members, and passwords never shown, echoed or logged.
 *
 * Every user and role here is created by the test (e2e markers); seed accounts are never changed through the UI. The one DB-level
 * change to seed rows (deactivating the other Super Admins) is undone in `finally`.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, uiLogin, expectLoginRefused } from "../fixtures";
import {
  ROLE_PRESETS, SUPER_ADMIN_ROLE_ID, auditRows, count, createAdmin, createAdminRole, createMember, createUser,
  deactivateOtherSuperAdmins, one, q, uniqueEmail, uniqueName, uniquePassword, userByEmail, userById, RUN,
} from "../support/db";
import { SEED } from "../support/env";
import { t, re } from "../support/i18n";

/* ── helpers ───────────────────────────────────────────────────────────────────── */

const tu = (k: string, v?: Record<string, string | number>) => t(`adminUsers.${k}`, v);
const userPage = (p: Page, id: string) => p.goto(`/en/admin/users/${encodeURIComponent(id)}`);
const listPage = (p: Page, query = "") => p.goto(`/en/admin/users${query}`);
/** Page-level notice from `?msg=` (success → role=status, error → role=alert), as on the member account page. */
const notice = (p: Page) => p.locator("main .alert").first();
const rows = (p: Page) => p.locator("main table tbody tr");
const row = (p: Page, email: string) => p.locator("main table tbody tr", { hasText: email });
/** A status tab ("All" / "Active" / "Inactive" + count): the label must be the whole text apart from the count. */
const tab = (p: Page, key: "f_all" | "f_active" | "f_inactive") =>
  p.locator("nav.adm-tabs a").filter({ hasText: new RegExp(`^\\s*${re(tu(key)).source}\\s*\\d*\\s*$`) });
const VIEWER = ROLE_PRESETS.viewer;
const POWERFUL = ROLE_PRESETS.memberManager; // members: full, events: view, messages: view
const BCRYPT_RE = /\$2[aby]\$\d\d\$/; // a bcrypt hash anywhere in a page would be a leak

/** Audit rows for an action whose target is `<id>` or `<id> (…)` (e.g. "id (role: …)"). */
const auditFor = (action: string, id: string) =>
  q<{ id: string; target: string | null; actor: string }>(`SELECT * FROM "AuditLog" WHERE action = $1 AND (target = $2 OR target LIKE $3)`, [action, id, `${id} %`]);
/** Audit rows anywhere that contain `s` (passwords must never be logged, in any column). */
const auditMentioning = (s: string) =>
  count(`SELECT count(*) AS n FROM "AuditLog" WHERE strpos(coalesce(target, '') || ' ' || actor || ' ' || action, $1) > 0`, [s]);

/** The form a forged replay is built from: re-point its hidden `uid` at another account (the server must re-check). */
const repoint = (form: Locator, uid: string) =>
  form.evaluate((f, id) => { (f.querySelector("input[name=uid]") as HTMLInputElement).value = id; }, uid);
/** The fields a form would post (FormData order), and a no-JavaScript multipart POST of them (redirects not followed). */
type Entries = [string, string][];
const formEntries = (form: Locator) =>
  form.evaluate((f: HTMLFormElement) => Array.from(new FormData(f).entries()).map(([k, v]) => [k, String(v)] as [string, string]));
const postForm = (ctx: APIRequestContext, path: string, entries: Entries) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return ctx.post(path, { multipart: fd, maxRedirects: 0 });
};
/** Skip the browser's own checks (required, type=email, minlength) so the server-side validation is what answers. */
const noValidate = (form: Locator) => form.evaluate((f) => { (f as HTMLFormElement).noValidate = true; });

/** Admin sidebar links (desktop: the side nav; phones: the menu panel), as in auth.spec. */
async function sidebarLinks(p: Page, isMobile: boolean) {
  if (isMobile) { await p.locator("details.adm-mnav > summary").click(); return p.locator("nav.adm-mnav-wrap .adm-mnav-links a"); }
  return p.locator("nav.adm-sidenav a");
}
const navText = (keys: string[]) => keys.map((k) => re(t(`adminNav.${k}`)));

async function submitLogin(p: Page, email: string, password: string) {
  await p.goto("/en/login");
  await p.locator("#le").fill(email);
  await p.locator("#lp").fill(password);
  await p.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
}

/* Create-user form (/admin/users/new). */
type NewUser = { name: string; email: string; password: string; confirm?: string; roleId: string };
const createForm = (p: Page) => p.locator("main form", { has: p.locator("#u-email") });
async function fillCreate(p: Page, v: NewUser) {
  await p.locator("#u-name").fill(v.name);
  await p.locator("#u-email").fill(v.email);
  await p.locator("#u-pw").fill(v.password);
  await p.locator("#u-pw2").fill(v.confirm ?? v.password);
  // "" = the "Choose a role" placeholder (set directly: it may be a disabled option).
  if (v.roleId) await p.locator("#u-role").selectOption(v.roleId);
  else await p.locator("#u-role").evaluate((s) => { (s as HTMLSelectElement).value = ""; });
}
const submitCreate = (p: Page) => createForm(p).getByRole("button", { name: tu("createButton") }).click();
/** A refused create: the error in an alert, the typed name/email/role kept, both password fields empty, nothing created. */
async function expectCreateRefused(p: Page, errKey: string, v: { name: string; email: string; roleId: string; password: string }, opts: { keepEmail?: boolean; keepRole?: boolean } = {}) {
  await expect(createForm(p).getByRole("alert").filter({ hasText: tu(errKey) }).first()).toBeVisible();
  await expect(p).toHaveURL(/\/en\/admin\/users\/new$/);
  await expect(p.locator("#u-name")).toHaveValue(v.name);
  if (opts.keepEmail !== false) await expect(p.locator("#u-email")).toHaveValue(v.email);
  if (opts.keepRole !== false) await expect(p.locator("#u-role")).toHaveValue(v.roleId);
  await expect(p.locator("#u-pw")).toHaveValue("");
  await expect(p.locator("#u-pw2")).toHaveValue("");
  const html = await p.content();
  for (const pw of [v.password, (v as NewUser).confirm]) // (skip a "password" that is the email itself: the email field keeps it)
    if (pw && pw !== v.email) expect(html, "a typed password is never echoed back").not.toContain(pw);
}

/* Account page sections (/admin/users/<id>). */
/** The form of a section: the section itself may be the <form id=…>, or contain it. */
const sectionForms = (p: Page, id: string) => p.locator(`form#${id}, #${id} form`);
const detailsForm = (p: Page) => sectionForms(p, "details").first();
const roleForm = (p: Page) => sectionForms(p, "role").filter({ has: p.locator("select") });
const pwForm = (p: Page) => sectionForms(p, "password");
const deactivateForm = (p: Page) => sectionForms(p, "status").filter({ has: p.getByRole("button", { name: tu("deactivateYes") }) });
/** Controls a user can actually operate (a disabled select or a note is fine). */
const liveControls = (scope: Locator) =>
  scope.locator("button:not([disabled]), select:not([disabled]), input:not([type=hidden]):not([disabled]), textarea:not([disabled])");

async function saveDetails(p: Page, name: string, email: string) {
  await p.locator("#details").getByLabel(tu("f_name"), { exact: true }).fill(name);
  await p.locator("#details").getByLabel(tu("f_email"), { exact: true }).fill(email);
  await p.locator("#details").getByRole("button", { name: tu("saveDetails") }).click();
}
async function changeRole(p: Page, roleId: string) {
  await roleForm(p).locator("select").selectOption(roleId);
  await roleForm(p).getByRole("button", { name: tu("changeRole") }).click();
}
/** Open the "Deactivate" confirm step (a <details>), tick its confirmation box if it has one. */
async function openDeactivate(p: Page) {
  await p.locator("#status summary", { hasText: tu("deactivate") }).click();
  const box = deactivateForm(p).locator("input[type=checkbox][name=confirm]");
  if (await box.count()) await box.check();
}
async function deactivate(p: Page) {
  await openDeactivate(p);
  await deactivateForm(p).getByRole("button", { name: tu("deactivateYes") }).click();
}
async function resetPassword(p: Page, pw: string, confirm = pw) {
  await pwForm(p).getByLabel(tu("pwNew"), { exact: true }).fill(pw);
  await pwForm(p).getByLabel(tu("pwConfirm"), { exact: true }).fill(confirm);
  await pwForm(p).getByRole("button", { name: tu("pwButton") }).click();
}

/* ── list and search ───────────────────────────────────────────────────────────── */

test("users list: Admin Portal accounts only, search, status tabs with counts, role filter", async ({ adminPage: p }) => {
  const tok = `Usr${RUN}${Math.random().toString(36).slice(2, 6)}`;
  const role = await createAdminRole({ permissions: VIEWER });
  const a1 = await createUser({ role: "admin", adminRoleId: role.id, name: `E2E ${tok} Alpha` });
  const a2 = await createUser({ role: "admin", adminRoleId: role.id, name: `E2E ${tok} Bravo` });
  const a3 = await createUser({ role: "admin", adminRoleId: role.id, name: `E2E ${tok} Charlie`, active: false });
  const member = await createMember({ name: `E2E ${tok} Member` }); // same token: must never show up in Users

  await listPage(p);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText(tu("title"));
  await expect(p.getByRole("link", { name: tu("newUser") })).toHaveAttribute("href", "/en/admin/users/new");
  expect(await p.content(), "no password hashes in the page").not.toMatch(BCRYPT_RE);

  // Search (name or email, case-insensitive): the three admins, never the member.
  await listPage(p, `?q=${encodeURIComponent(tok.toLowerCase())}`);
  await expect(p.getByRole("search").getByRole("searchbox")).toHaveValue(tok.toLowerCase());
  await expect(rows(p)).toHaveCount(3);
  await expect(row(p, member.email)).toHaveCount(0);
  await expect(rows(p).first()).toContainText(a1.name); // name order
  for (const u of [a1, a2]) await expect(row(p, u.email).getByText(tu("active"), { exact: true })).toBeVisible();
  await expect(row(p, a3.email).getByText(tu("inactive"), { exact: true })).toBeVisible();
  await expect(row(p, a1.email)).toContainText(role.name);
  await expect(row(p, a1.email).getByRole("link", { name: a1.name })).toHaveAttribute("href", `/en/admin/users/${a1.id}`);
  await expect(row(p, a1.email).getByRole("link", { name: tu("manage") })).toBeVisible();

  // Tabs count within the current search; the Inactive tab lists only the deactivated account.
  await expect(tab(p, "f_all").locator(".tab-n")).toHaveText("3");
  await expect(tab(p, "f_active").locator(".tab-n")).toHaveText("2");
  await expect(tab(p, "f_inactive").locator(".tab-n")).toHaveText("1");
  await tab(p, "f_inactive").click();
  await expect(tab(p, "f_inactive")).toHaveAttribute("aria-current", "page");
  await expect(rows(p)).toHaveCount(1);
  await expect(rows(p).first()).toContainText(a3.email);
  await tab(p, "f_active").click();
  await expect(rows(p)).toHaveCount(2);
  await expect(row(p, a3.email)).toHaveCount(0);

  // Email search, upper case; literal % and _ (no wildcards); the member's email finds nothing.
  await listPage(p, `?q=${encodeURIComponent(a2.email.toUpperCase())}`);
  await expect(rows(p)).toHaveCount(1);
  await expect(rows(p).first()).toContainText(a2.email);
  for (const needle of [`${tok}%Bravo`, `${tok} _ravo`, member.email]) {
    await listPage(p, `?q=${encodeURIComponent(needle)}`);
    await expect(rows(p), needle).toHaveCount(0);
    await expect(p.locator("main")).toContainText(tu("empty"));
  }

  // Role filter (?role=<id>, as linked from the Roles page): a removable chip with the role name.
  await listPage(p, `?role=${encodeURIComponent(role.id)}`);
  await expect(p.locator("main")).toContainText(tu("roleFilter", { role: role.name }));
  await expect(rows(p)).toHaveCount(3);
  await expect(tab(p, "f_all").locator(".tab-n")).toHaveText("3");
  await p.getByRole("link", { name: tu("clearFilter") }).click();
  await expect(p).not.toHaveURL(/[?&]role=/);
  await expect(p.locator("main")).not.toContainText(tu("roleFilter", { role: role.name }));

  // The signed-in admin's own row says "You".
  await listPage(p, `?q=${encodeURIComponent(SEED.admin)}`);
  await expect(row(p, SEED.admin).getByText(tu("you"), { exact: true })).toBeVisible();

  // Notice for a stale link.
  await listPage(p, "?msg=notFound");
  await expect(notice(p)).toHaveText(tu("notFound"));
});

/* ── create ────────────────────────────────────────────────────────────────────── */

test("create a user without an invitation: they can sign in right away @smoke", async ({ adminPage: p, newPage, isMobile }) => {
  const role = await createAdminRole({ permissions: VIEWER });
  const v = { name: uniqueName("Staff"), email: uniqueEmail(), password: uniquePassword(), roleId: role.id };

  await listPage(p);
  await p.getByRole("link", { name: tu("newUser") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/users\/new$/);
  await expect(p.locator("#u-pw")).toHaveAttribute("type", "password");
  await expect(p.locator("#u-pw2")).toHaveAttribute("type", "password");
  await expect(p.locator("#u-pw")).toHaveAttribute("autocomplete", "new-password");
  // Role dropdown: the placeholder, then Super Admin first, then the roles by name (incl. ours).
  await expect(p.locator("#u-role option").first()).toHaveText(tu("chooseRole"));
  await expect(p.locator("#u-role option").first()).toHaveAttribute("value", "");
  await expect(p.locator("#u-role option").nth(1)).toHaveAttribute("value", SUPER_ADMIN_ROLE_ID);
  await expect(p.locator(`#u-role option[value="${role.id}"]`)).toHaveText(role.name);
  await expect(p.locator("main")).toContainText(tu("pwHint"));

  await fillCreate(p, v);
  await submitCreate(p);
  await expect(p).toHaveURL(/\/en\/admin\/users\/[^/?#]+\?msg=msg_created/);
  await expect(notice(p)).toHaveText(tu("msg_created"));
  expect(p.url()).not.toContain(v.password);
  expect(await p.content(), "the password is never shown").not.toContain(v.password);
  expect(await p.content()).not.toMatch(BCRYPT_RE);

  const u = (await userByEmail(v.email))!;
  expect(u).toMatchObject({ name: v.name, role: "admin", active: true, adminRoleId: role.id, sessionVersion: 0 });
  expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
  expect(p.url()).toContain(`/en/admin/users/${u.id}?`);
  await expect(p.getByRole("heading", { level: 1 })).toContainText(v.name);
  await expect(p.locator("main")).toContainText(role.name);
  expect(await auditRows({ action: "admin_user.created", target: `${u.id} (role: ${role.id})` })).toHaveLength(1);
  expect(await auditMentioning(v.password), "no audit row contains the password").toBe(0);
  expect(await auditMentioning(u.passwordHash), "no audit row contains the hash").toBe(0);

  // Listed under Active.
  await listPage(p, `?q=${encodeURIComponent(v.email)}`);
  await tab(p, "f_active").click();
  await expect(row(p, v.email).getByText(tu("active"), { exact: true })).toBeVisible();

  // No invitation step: the typed password works now, and the new user lands on their role's admin home.
  const s = await newPage();
  await uiLogin(s, { email: v.email, password: v.password }, { expectUrl: /\/en\/admin\/members$/ });
  await expect(s.locator("header.admin-header")).toBeVisible();
  await expect(await sidebarLinks(s, isMobile)).toHaveText(navText(["members", "events", "messages"]));
});

test("create user: the landing page follows the role (events-only → Events; Super Admin → Members with Users and Roles)", async ({ adminPage: p, newPage }) => {
  const events = await createAdminRole({ permissions: ROLE_PRESETS.eventsOnly });
  for (const [roleId, home, nav] of [
    [events.id, /\/en\/admin\/events$/, ["events"]],
    [SUPER_ADMIN_ROLE_ID, /\/en\/admin\/members$/, ["members", "events", "messages", "users", "roles"]],
  ] as const) {
    const v = { name: uniqueName("Staff"), email: uniqueEmail(), password: uniquePassword(), roleId };
    await p.goto("/en/admin/users/new");
    await fillCreate(p, v);
    await submitCreate(p);
    await expect(p).toHaveURL(/\?msg=msg_created/);
    expect((await userByEmail(v.email))!.adminRoleId).toBe(roleId);
    const s = await newPage();
    await uiLogin(s, v, { expectUrl: home });
    await expect(await sidebarLinks(s, false)).toHaveText(navText([...nav]));
  }
});

test("create user: validation keeps the typed name, email and role but never the passwords", async ({ adminPage: p }) => {
  const role = await createAdminRole({ permissions: VIEWER });
  const base = () => ({ name: uniqueName("Staff"), email: uniqueEmail(), password: uniquePassword(), roleId: role.id });
  const attempt = async (v: NewUser, errKey: string, prep?: () => Promise<void>, keepRole = true) => {
    await p.goto("/en/admin/users/new");
    await noValidate(createForm(p));
    if (prep) await prep();
    await fillCreate(p, v);
    await submitCreate(p);
    await expectCreateRefused(p, errKey, v, { keepRole });
    expect(await count(`SELECT count(*) AS n FROM "User" WHERE lower(email) = lower($1)`, [v.email]), `${errKey}: nothing created`).toBe(0);
  };

  await attempt({ ...base(), name: "" }, "err_name");
  await attempt({ ...base(), email: "not-an-email" }, "err_email");
  await attempt({ ...base(), email: "e2e@@example.test" }, "err_email");
  await attempt({ ...base(), password: "Short-pw1!" }, "err_pw_short"); // 10 characters
  await attempt({ ...base(), password: "password1234!" }, "err_pw_common");
  await attempt({ ...base(), password: "aaaaaaaaaaaaaa" }, "err_pw_common");
  { const v = base(); await attempt({ ...v, password: v.email, confirm: v.email }, "err_pw_common"); } // equal to the email
  await attempt({ ...base(), password: "", confirm: "" }, "err_pw_blank");
  await attempt({ ...base(), confirm: uniquePassword() }, "err_pwMismatch");
  await attempt({ ...base(), roleId: "" }, "err_role");
  // Forged: a role id that doesn't exist (added to the dropdown).
  await attempt({ ...base(), roleId: "e2e-no-such-role" }, "err_role", () =>
    p.locator("#u-role").evaluate((s) => { const o = document.createElement("option"); o.value = "e2e-no-such-role"; o.text = "Forged"; s.appendChild(o); }), false);
});

test("create user: an email used by any account (member, guest, admin, any case) is refused", async ({ adminPage: p }) => {
  const role = await createAdminRole({ permissions: VIEWER });
  const member = await createMember();
  const guest = await createUser();
  const admin = await createAdmin(VIEWER);
  for (const [who, email] of [
    ["member", member.email], ["seed member", SEED.member], ["guest", guest.email], ["admin", admin.email],
    ["Super Admin", SEED.admin2], ["other case", guest.email.toUpperCase()],
  ] as const) {
    const v = { name: uniqueName("Staff"), email, password: uniquePassword(), roleId: role.id };
    await p.goto("/en/admin/users/new");
    await fillCreate(p, v);
    await submitCreate(p);
    await expectCreateRefused(p, "err_emailTaken", v, { keepEmail: false });
    await expect(p.locator("#u-email"), who).toHaveValue(new RegExp(`^${re(email).source}$`, "i"));
    expect(await count(`SELECT count(*) AS n FROM "User" WHERE lower(email) = lower($1)`, [email]), who).toBe(1);
  }
  // The existing accounts are untouched (separation: a member stays a member, with no admin role).
  expect(await userById(member.id)).toMatchObject({ role: "member", adminRoleId: null });
  expect(await userById(guest.id)).toMatchObject({ role: "guest", adminRoleId: null });
  expect(await userById(admin.id)).toMatchObject({ role: "admin", adminRoleId: admin.roleId });
});

/* ── edit ──────────────────────────────────────────────────────────────────────── */

test("edit name and email; duplicates and invalid emails are refused; the new email signs in", async ({ adminPage: p, newPage }) => {
  const u = await createAdmin(VIEWER);
  const name = uniqueName("Renamed"); const email = uniqueEmail();
  await userPage(p, u.id);
  await expect(p.getByRole("heading", { level: 1 })).toContainText(u.name);
  await expect(p.locator("main")).toContainText(u.email);
  await expect(p.locator("main")).toContainText(u.roleName);

  await saveDetails(p, name, email.toUpperCase());
  await expect(p).toHaveURL(/msg=msg_saved/);
  await expect(notice(p)).toHaveText(tu("msg_saved"));
  expect(await userById(u.id)).toMatchObject({ name, email, role: "admin", adminRoleId: u.roleId });
  expect((await auditFor("admin_user.updated", u.id)).length).toBeGreaterThanOrEqual(1);
  expect(await auditFor("admin_user.email_changed", u.id)).toHaveLength(1);

  // Nothing changed.
  await userPage(p, u.id);
  await p.locator("#details").getByRole("button", { name: tu("saveDetails") }).click();
  await expect(p).toHaveURL(/msg=msg_noChange/);
  await expect(notice(p)).toHaveText(tu("msg_noChange"));

  // Another account's email (a member's, then an admin's) and an invalid one are refused.
  for (const [taken, err] of [[SEED.member, "err_emailTaken"], [SEED.admin2, "err_emailTaken"], ["not-an-email", "err_email"]] as const) {
    await userPage(p, u.id);
    await noValidate(detailsForm(p));
    await saveDetails(p, name, taken);
    await expect(p, taken).toHaveURL(new RegExp(`msg=${err}`));
    await expect(notice(p)).toHaveText(tu(err));
    expect((await userById(u.id))!.email, taken).toBe(email);
  }
  // A blank name is refused.
  await userPage(p, u.id);
  await noValidate(detailsForm(p));
  await saveDetails(p, "", email);
  await expect(p).toHaveURL(/msg=err_name/);
  expect((await userById(u.id))!.name).toBe(name);

  // The new email signs in with the unchanged password; the old one no longer does.
  const s = await newPage();
  await submitLogin(s, u.email, u.password);
  await expectLoginRefused(s, t("auth.invalid"));
  await uiLogin(s, { email, password: u.password }, { expectUrl: /\/en\/admin\/members$/ });
});

/* ── role change ───────────────────────────────────────────────────────────────── */

test("change role: the user's open session ends on their next request and the new access applies", async ({ adminPage: p, loginAs, newPage }) => {
  const u = await createAdmin(VIEWER);
  const target = await createAdminRole({ permissions: { events: ["view", "create", "edit", "delete"], users: ["view"] } });
  const session = await loginAs(u, { expectUrl: /\/en\/admin\/members$/ });
  const sv = (await userById(u.id))!.sessionVersion;

  await userPage(p, u.id);
  await expect(roleForm(p).locator("select")).toHaveValue(u.roleId);
  await expect(roleForm(p).locator(`option[value="${SUPER_ADMIN_ROLE_ID}"]`)).toHaveCount(1); // a Super Admin may assign it
  // Same role → nothing changes (no sign-out).
  await changeRole(p, u.roleId);
  await expect(p).toHaveURL(/msg=msg_noChange/);
  expect((await userById(u.id))!.sessionVersion).toBe(sv);

  await userPage(p, u.id);
  await changeRole(p, target.id);
  await expect(p).toHaveURL(/msg=msg_roleChanged/);
  await expect(notice(p)).toHaveText(tu("msg_roleChanged"));
  expect(await userById(u.id)).toMatchObject({ adminRoleId: target.id, sessionVersion: sv + 1, active: true });
  expect(await auditRows({ action: "admin_user.role_changed", target: `${u.id} (role: ${target.id})` })).toHaveLength(1);
  await expect(p.locator("main")).toContainText(target.name);

  // The open session is rejected on its next request.
  await session.goto("/en/admin/members");
  await expect(session).toHaveURL(/\/en\/login/);
  expect((await session.request.get("/api/admin/members.csv")).status()).toBe(403);

  // Signing in again gives the new role's access: Events + Users, landing on Events; Members is refused.
  const s = await newPage();
  await uiLogin(s, u, { expectUrl: /\/en\/admin\/events$/ });
  await expect(await sidebarLinks(s, false)).toHaveText(navText(["events", "users"]));
  await s.goto("/en/admin/members");
  await expect(s).toHaveURL(/\/en\/admin\/no-access$/);
});

/* ── deactivate / reactivate ───────────────────────────────────────────────────── */

test("deactivate: open session rejected, sign-in refused with the generic error; reactivate restores access", async ({ adminPage: p, loginAs, newPage }) => {
  const u = await createAdmin(VIEWER);
  const session = await loginAs(u, { expectUrl: /\/en\/admin\/members$/ });
  const sv = (await userById(u.id))!.sessionVersion;

  await userPage(p, u.id);
  await expect(p.locator("#status")).toContainText(tu("statusActive"));
  // The confirm step names the user; without the confirmation (forged) nothing happens.
  await openDeactivate(p);
  await expect(p.locator("#status")).toContainText(tu("deactivateConfirm", { name: u.name }));
  const box = deactivateForm(p).locator("input[type=checkbox][name=confirm]");
  if (await box.count()) {
    await box.uncheck();
    await noValidate(deactivateForm(p));
    await deactivateForm(p).getByRole("button", { name: tu("deactivateYes") }).click();
    await expect(p).toHaveURL(/msg=err_confirm/);
    expect((await userById(u.id))!.active).toBe(true);
    await userPage(p, u.id);
  }
  await deactivate(p);
  await expect(p).toHaveURL(/msg=msg_deactivated/);
  await expect(notice(p)).toHaveText(tu("msg_deactivated"));
  await expect(p.locator("#status")).toContainText(tu("statusInactive"));
  expect(await userById(u.id)).toMatchObject({ active: false, sessionVersion: sv + 1, adminRoleId: u.roleId });
  expect(await auditFor("admin_user.deactivated", u.id)).toHaveLength(1);

  // The open session dies on its next request (pages and APIs).
  await session.goto("/en/admin/events");
  await expect(session).toHaveURL(/\/en\/login/);
  expect((await session.request.get("/api/admin/members.csv")).status()).toBe(403);

  // The right password gets exactly the wrong-password message (no account-existence leak).
  const s = await newPage();
  await submitLogin(s, u.email, "Wrong-password-123");
  await expectLoginRefused(s, t("auth.invalid"), { email: u.email });
  const blockedBefore = (await auditRows({ action: "auth.login_blocked_inactive", target: u.email })).length;
  await submitLogin(s, u.email, u.password);
  await expectLoginRefused(s, t("auth.invalid"), { email: u.email });
  expect((await auditRows({ action: "auth.login_blocked_inactive", target: u.email })).length).toBe(blockedBefore + 1);

  // The list shows it under Inactive.
  await listPage(p, `?q=${encodeURIComponent(u.email)}`);
  await tab(p, "f_inactive").click();
  await expect(row(p, u.email).getByText(tu("inactive"), { exact: true })).toBeVisible();
  await tab(p, "f_active").click();
  await expect(row(p, u.email)).toHaveCount(0);

  // Reactivate.
  await userPage(p, u.id);
  await p.locator("#status").getByRole("button", { name: tu("activate"), exact: true }).click();
  await expect(p).toHaveURL(/msg=msg_activated/);
  await expect(notice(p)).toHaveText(tu("msg_activated"));
  expect((await userById(u.id))!.active).toBe(true);
  expect(await auditFor("admin_user.activated", u.id)).toHaveLength(1);
  await uiLogin(s, u, { expectUrl: /\/en\/admin\/members$/ });
  await expect(s.locator("header.admin-header")).toBeVisible();
});

/* ── password reset ────────────────────────────────────────────────────────────── */

test("password reset by an admin: policy and mismatch errors; old password fails, new works, session ends, never echoed", async ({ adminPage: p, loginAs, newPage }) => {
  const u = await createAdmin(VIEWER);
  const session = await loginAs(u, { expectUrl: /\/en\/admin\/members$/ });
  const before = (await userById(u.id))!;

  await userPage(p, u.id);
  await expect(p.locator("#password")).toContainText(tu("pwResetHint"));
  await expect(pwForm(p).getByLabel(tu("pwNew"), { exact: true })).toHaveAttribute("type", "password");
  await expect(pwForm(p).getByLabel(tu("pwConfirm"), { exact: true })).toHaveAttribute("type", "password");
  for (const [pw, confirm, err] of [
    [uniquePassword(), uniquePassword(), "err_pwMismatch"],
    ["Short-pw1!", "Short-pw1!", "err_pw_short"],
    ["password1234!", "password1234!", "err_pw_common"],
    [u.email, u.email, "err_pw_common"],
  ] as const) {
    await noValidate(pwForm(p)); // the server's policy answers, not the browser's minlength
    await resetPassword(p, pw, confirm);
    await expect(pwForm(p).getByRole("alert"), err).toHaveText(tu(err));
    // Clear what we typed: the refused password must not be rendered anywhere else on the page.
    await pwForm(p).getByLabel(tu("pwNew"), { exact: true }).fill("");
    await pwForm(p).getByLabel(tu("pwConfirm"), { exact: true }).fill("");
    if (pw !== u.email) expect(await p.content(), "a refused password is not echoed").not.toContain(pw);
    const now = (await userById(u.id))!;
    expect(now.passwordHash, err).toBe(before.passwordHash);
    expect(now.sessionVersion, err).toBe(before.sessionVersion);
  }

  const newPassword = uniquePassword();
  await resetPassword(p, newPassword);
  await expect(pwForm(p).getByRole("status")).toContainText(tu("msg_pwReset"));
  await expect(pwForm(p).getByLabel(tu("pwNew"), { exact: true })).toHaveValue(""); // the form remounts empty
  await expect(pwForm(p).getByLabel(tu("pwConfirm"), { exact: true })).toHaveValue("");
  expect(p.url()).not.toContain(newPassword);
  expect(await p.content(), "the new password is never shown").not.toContain(newPassword);
  expect(await p.content()).not.toMatch(BCRYPT_RE);
  const after = (await userById(u.id))!;
  expect(after.passwordHash).toMatch(/^\$2[aby]\$/);
  expect(after.passwordHash).not.toBe(before.passwordHash);
  expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  expect(after).toMatchObject({ active: true, adminRoleId: u.roleId });
  expect(await auditFor("admin_user.password_reset", u.id)).toHaveLength(1);
  expect(await auditMentioning(newPassword), "no audit row contains the new password").toBe(0);
  // Reloading the page does not bring it back either.
  await userPage(p, u.id);
  expect(await p.content()).not.toContain(newPassword);

  // The user's existing session is signed out.
  await session.goto("/en/admin/members");
  await expect(session).toHaveURL(/\/en\/login/);
  // Old password refused, new one accepted.
  const s = await newPage();
  await submitLogin(s, u.email, u.password);
  await expectLoginRefused(s, t("auth.invalid"), { email: u.email });
  await uiLogin(s, { email: u.email, password: newPassword }, { expectUrl: /\/en\/admin\/members$/ });
});

/* ── unlock ────────────────────────────────────────────────────────────────────── */

test("a locked admin user shows as Locked and can be unlocked", async ({ adminPage: p, page }) => {
  const u = await createAdmin(VIEWER);
  for (let i = 1; i <= 5; i++) await submitLogin(page, u.email, `Wrong-password-${i}xx`);
  await submitLogin(page, u.email, u.password);
  await expectLoginRefused(page, t("auth.locked"), { email: u.email });

  await listPage(p, `?q=${encodeURIComponent(u.email)}`);
  await expect(row(p, u.email).getByText(tu("locked"), { exact: true })).toBeVisible();
  await userPage(p, u.id);
  await p.locator("#status").getByRole("button", { name: tu("unlock") }).click();
  await expect(p).toHaveURL(/msg=msg_unlocked/);
  await expect(notice(p)).toHaveText(tu("msg_unlocked"));
  expect(await one(`SELECT key FROM "LoginThrottle" WHERE key = $1`, [`e:${u.email}`])).toBeUndefined();
  expect(await auditRows({ action: "auth.account_unlocked", target: u.id })).toHaveLength(1);
  await uiLogin(page, u, { expectUrl: /\/en\/admin\/members$/ });
});

/* ── protections ───────────────────────────────────────────────────────────────── */

test("self: no role, status or password controls on your own page; forged self-changes are refused", async ({ adminPage: p }) => {
  const me = (await userByEmail(SEED.admin))!;
  const other = await createAdmin(VIEWER);
  const viewerRole = other.roleId;
  const otherBefore = (await userById(other.id))!;

  await userPage(p, me.id);
  await expect(p.locator("main").getByText(tu("you"), { exact: true }).first()).toBeVisible();
  await expect(p.locator("main")).toContainText(tu("selfNote"));
  for (const sec of ["#role", "#status", "#password"]) await expect(liveControls(p.locator(sec)), sec).toHaveCount(0);
  await expect(pwForm(p)).toHaveCount(0);
  expect(await p.content()).not.toMatch(BCRYPT_RE);

  // Forged: another user's forms re-pointed at my own id.
  await userPage(p, other.id);
  await roleForm(p).locator("select").selectOption(viewerRole);
  await repoint(roleForm(p), me.id);
  await roleForm(p).getByRole("button", { name: tu("changeRole") }).click();
  await expect(p).toHaveURL(/msg=err_self/);
  await expect(notice(p)).toHaveText(tu("err_self"));

  await userPage(p, other.id);
  await openDeactivate(p);
  await repoint(deactivateForm(p), me.id);
  await deactivateForm(p).getByRole("button", { name: tu("deactivateYes") }).click();
  await expect(p).toHaveURL(/msg=err_self/);

  await userPage(p, other.id);
  await repoint(pwForm(p), me.id);
  await resetPassword(p, uniquePassword());
  await expect(pwForm(p).getByRole("alert")).toHaveText(tu("err_self"));

  const after = (await userById(me.id))!;
  expect(after).toMatchObject({ role: "admin", active: true, adminRoleId: SUPER_ADMIN_ROLE_ID, sessionVersion: me.sessionVersion, passwordHash: me.passwordHash });
  expect(await userById(other.id)).toMatchObject({ active: true, adminRoleId: viewerRole, passwordHash: otherBefore.passwordHash, sessionVersion: otherBefore.sessionVersion });
  // Still signed in (the seed session was not touched).
  await p.goto("/en/admin/users");
  await expect(p).toHaveURL(/\/en\/admin\/users$/);
});

test("the last active Super Admin cannot be deactivated, demoted or deleted", async ({ loginAs }) => {
  // A member's real "Delete my account" form, replayed by the admin below (admin profiles have no delete form any more).
  const member = await createMember();
  const mp = await loginAs(member);
  await mp.goto("/en/my/profile");
  const delFields = (await formEntries(mp.locator("form.mbr-danger"))).filter(([k]) => k !== "password" && k !== "confirm");

  const x = await createUser({ role: "admin" }); // Super Admin
  const other = await createAdmin(VIEWER);
  const xp = await loginAs(x, { expectUrl: /\/en\/admin\/members$/ });
  const restore = await deactivateOtherSuperAdmins(x.id);
  try {
    expect(await count(`SELECT count(*) AS n FROM "User" WHERE role = 'admin' AND active AND "adminRoleId" = $1`, [SUPER_ADMIN_ROLE_ID])).toBe(1);
    // Own page: no way to demote or deactivate.
    await userPage(xp, x.id);
    for (const sec of ["#role", "#status"]) await expect(liveControls(xp.locator(sec)), sec).toHaveCount(0);
    // Forged self-demotion and self-deactivation (another user's forms re-pointed at X).
    await userPage(xp, other.id);
    await roleForm(xp).locator("select").selectOption(other.roleId);
    await repoint(roleForm(xp), x.id);
    await roleForm(xp).getByRole("button", { name: tu("changeRole") }).click();
    await expect(xp).toHaveURL(/msg=err_(self|lastSuperAdmin)/);
    await userPage(xp, other.id);
    await openDeactivate(xp);
    await repoint(deactivateForm(xp), x.id);
    await deactivateForm(xp).getByRole("button", { name: tu("deactivateYes") }).click();
    await expect(xp).toHaveURL(/msg=err_(self|lastSuperAdmin)/);
    // Self-deletion: Admin Portal accounts can't delete themselves at all (round-7 S1): no delete form, a note instead…
    await xp.goto("/en/my/profile");
    await expect(xp.locator("main #dp")).toHaveCount(0);
    await expect(xp.locator(".mbr-admin-close")).toContainText(t("profile.adminCloseNote"));
    // …and a forged post of the member's delete form (with the admin's correct password) is refused with del=admin.
    const r = await postForm(xp.request, "/en/my/profile", [...delFields, ["password", x.password], ["confirm", "on"]]);
    expect(r.status()).toBe(303);
    expect(r.headers()["location"]).toMatch(/\/en\/my\/profile\?del=admin$/);
    await xp.goto("/en/my/profile?del=admin");
    await expect(xp.locator(".mbr-admin-close").getByRole("alert")).toHaveText(t("profile.deleteAdminBlocked"));
    expect(await userById(x.id)).toMatchObject({ role: "admin", active: true, adminRoleId: SUPER_ADMIN_ROLE_ID, deletedAt: null, email: x.email });
    expect((await auditRows({ action: "account.delete_blocked_admin", target: x.id })).length).toBeGreaterThanOrEqual(1);
  } finally {
    await restore();
  }
  expect((await userById((await userByEmail(SEED.admin))!.id))!.active).toBe(true);
});

test("you can't edit, re-role, deactivate or reset a more powerful user (UI hidden, forged forms refused)", async ({ loginAs }) => {
  const actor = await createAdmin({ users: ["view", "create", "edit"], members: ["view"] });
  const weak = await createAdmin({ members: ["view"] }); // subset of the actor's permissions: manageable
  const strong = await createAdmin(POWERFUL); // members: full → not a subset
  const sup = await createUser({ role: "admin" }); // Super Admin
  const snap = async () => Promise.all([strong.id, sup.id].map(async (id) => {
    const r = (await userById(id))!; return { name: r.name, email: r.email, active: r.active, adminRoleId: r.adminRoleId, passwordHash: r.passwordHash, sessionVersion: r.sessionVersion };
  }));
  const before = await snap();
  const a = await loginAs(actor, { expectUrl: /\/en\/admin\/members$/ });

  // List: "Manage" for the weaker user, "View" for the stronger ones.
  await a.goto(`/en/admin/users?q=${encodeURIComponent(weak.email)}`);
  await expect(row(a, weak.email).getByRole("link", { name: tu("manage") })).toBeVisible();
  await a.goto(`/en/admin/users?q=${encodeURIComponent(strong.email)}`);
  await expect(row(a, strong.email).getByRole("link", { name: tu("view") })).toBeVisible();

  // Their pages are read-only with the reason.
  await userPage(a, strong.id);
  await expect(a.locator("main")).toContainText(tu("targetNote"));
  for (const sec of ["#details", "#role", "#status", "#password"]) await expect(liveControls(a.locator(sec)), `strong ${sec}`).toHaveCount(0);
  await userPage(a, sup.id);
  await expect(a.locator("main")).toContainText(tu("superNote"));
  for (const sec of ["#details", "#role", "#status", "#password"]) await expect(liveControls(a.locator(sec)), `super ${sec}`).toHaveCount(0);

  // The role dropdown only offers roles within the actor's own permissions (never Super Admin or the stronger role).
  await userPage(a, weak.id);
  await expect(roleForm(a).locator(`option[value="${SUPER_ADMIN_ROLE_ID}"]`)).toHaveCount(0);
  await expect(roleForm(a).locator(`option[value="${strong.roleId}"]`)).toHaveCount(0);
  await expect(roleForm(a).locator(`option[value="${weak.roleId}"]`)).toHaveCount(1);

  // Forged: the weaker user's forms re-pointed at the stronger users.
  for (const [target, err] of [[strong, "err_target"], [sup, "err_superOnly"]] as const) {
    await userPage(a, weak.id);
    await repoint(detailsForm(a), target.id);
    await saveDetails(a, uniqueName("Hijack"), uniqueEmail());
    await expect(a, `details → ${err}`).toHaveURL(new RegExp(`msg=${err}`));
    await expect(notice(a)).toHaveText(tu(err));

    await userPage(a, weak.id);
    await roleForm(a).locator("select").selectOption(weak.roleId);
    await repoint(roleForm(a), target.id);
    await roleForm(a).getByRole("button", { name: tu("changeRole") }).click();
    await expect(a, `role → ${err}`).toHaveURL(new RegExp(`msg=${err}`));

    await userPage(a, weak.id);
    await openDeactivate(a);
    await repoint(deactivateForm(a), target.id);
    await deactivateForm(a).getByRole("button", { name: tu("deactivateYes") }).click();
    await expect(a, `status → ${err}`).toHaveURL(new RegExp(`msg=${err}`));

    await userPage(a, weak.id);
    await repoint(pwForm(a), target.id);
    await resetPassword(a, uniquePassword());
    await expect(pwForm(a).getByRole("alert"), `password → ${err}`).toHaveText(tu(err));
  }
  expect(await snap(), "the stronger users are unchanged").toEqual(before);

  // Control: the same actor can reset the weaker user's password (the refusals above are real checks).
  await userPage(a, weak.id);
  await resetPassword(a, uniquePassword());
  await expect(pwForm(a).getByRole("status")).toContainText(tu("msg_pwReset"));
  expect((await userById(weak.id))!.sessionVersion).toBe(1);
});

test("peers: equal permissions can't manage each other (UI read-only, forged details/role/status/password refused) — S1", async ({ loginAs }) => {
  const PERMS = { users: ["view", "create", "edit"], members: ["view"] } as const;
  const actor = await createAdmin(PERMS);
  const peerSameRole = await createUser({ role: "admin", adminRoleId: actor.roleId }); // the actor's own role
  const peerEqual = await createAdmin(PERMS); // another role with exactly the same permissions
  const weak = await createAdmin({ members: ["view"] }); // strict subset: still manageable (control)
  const snap = async () => Promise.all([peerSameRole.id, peerEqual.id].map(async (id) => {
    const r = (await userById(id))!; return { name: r.name, email: r.email, active: r.active, adminRoleId: r.adminRoleId, passwordHash: r.passwordHash, sessionVersion: r.sessionVersion };
  }));
  const before = await snap();
  const a = await loginAs(actor, { expectUrl: /\/en\/admin\/members$/ });

  for (const peer of [peerSameRole, peerEqual]) {
    await a.goto(`/en/admin/users?q=${encodeURIComponent(peer.email)}`);
    await expect(row(a, peer.email).getByRole("link", { name: tu("view") })).toBeVisible();
    await userPage(a, peer.id);
    await expect(a.locator("main")).toContainText(tu("peerNote"));
    await expect(a.locator("main")).not.toContainText(tu("targetNote"));
    for (const sec of ["#details", "#role", "#status", "#password"]) await expect(liveControls(a.locator(sec)), `peer ${sec}`).toHaveCount(0);
  }

  // Forged: the weaker user's forms re-pointed at each peer → err_peer, nothing written.
  for (const peer of [peerSameRole, peerEqual]) {
    await userPage(a, weak.id);
    await repoint(detailsForm(a), peer.id);
    await saveDetails(a, uniqueName("Hijack"), uniqueEmail());
    await expect(a, "details → err_peer").toHaveURL(/msg=err_peer/);
    await expect(notice(a)).toHaveText(tu("err_peer"));

    await userPage(a, weak.id);
    await roleForm(a).locator("select").selectOption(weak.roleId);
    await repoint(roleForm(a), peer.id);
    await roleForm(a).getByRole("button", { name: tu("changeRole") }).click();
    await expect(a, "role → err_peer").toHaveURL(/msg=err_peer/);

    await userPage(a, weak.id);
    await openDeactivate(a);
    await repoint(deactivateForm(a), peer.id);
    await deactivateForm(a).getByRole("button", { name: tu("deactivateYes") }).click();
    await expect(a, "status → err_peer").toHaveURL(/msg=err_peer/);

    // The SEC M-1 repro: a password reset of a peer (account takeover) is refused.
    await userPage(a, weak.id);
    await repoint(pwForm(a), peer.id);
    await resetPassword(a, uniquePassword());
    await expect(pwForm(a).getByRole("alert"), "password → err_peer").toHaveText(tu("err_peer"));
  }
  expect(await snap(), "the peers are unchanged").toEqual(before);
  for (const peer of [peerSameRole, peerEqual]) expect(await auditFor("admin_user.password_reset", peer.id)).toHaveLength(0);

  // Control: the strictly weaker user is still manageable.
  await userPage(a, weak.id);
  await resetPassword(a, uniquePassword());
  await expect(pwForm(a).getByRole("status")).toContainText(tu("msg_pwReset"));
});

test("own page: the sign-in email is read-only, the name stays editable; a forged own-email change is refused — S2", async ({ loginAs }) => {
  const me = await createAdmin({ users: ["view", "create", "edit"], members: ["view"] });
  const other = await createAdmin({ members: ["view"] });
  const p = await loginAs(me, { expectUrl: /\/en\/admin\/members$/ });

  await userPage(p, me.id);
  await expect(p.locator("#details input[name=email]:not([readonly]):not([disabled]):not([type=hidden])"), "no editable email field").toHaveCount(0);
  await expect(p.locator("#details input[name=email][readonly]")).toHaveValue(me.email); // read-only, still posted unchanged
  await expect(pwForm(p)).toHaveCount(0); // no password reset on your own page
  const name = uniqueName("Renamed");
  await p.locator("#details").getByLabel(tu("f_name"), { exact: true }).fill(name);
  await p.locator("#details").getByRole("button", { name: tu("saveDetails") }).click();
  await expect(p).toHaveURL(/msg=msg_saved/);
  expect(await userById(me.id)).toMatchObject({ name, email: me.email });

  // Forged: another user's details form re-pointed at my own id, with a new email.
  const newEmail = uniqueEmail();
  await userPage(p, other.id);
  await repoint(detailsForm(p), me.id);
  await saveDetails(p, name, newEmail);
  await expect(p).toHaveURL(/msg=err_emailSelf/);
  await expect(notice(p)).toHaveText(tu("err_emailSelf"));
  expect(await userById(me.id)).toMatchObject({ name, email: me.email });
  expect(await userByEmail(newEmail)).toBeUndefined();
  expect(await auditFor("admin_user.email_changed", me.id)).toHaveLength(0);
});

/* ── separation from Members ───────────────────────────────────────────────────── */

test("separation: admins are not in Members, members are not in Users, and Members can't create an admin", async ({ adminPage: p }) => {
  const admin = await createAdmin(VIEWER);
  const member = await createMember();

  await p.goto(`/en/admin/members?q=${encodeURIComponent(admin.email)}`);
  await expect(p.locator("main table tbody tr", { hasText: admin.email })).toHaveCount(0);
  for (const path of [`/en/admin/members/${admin.id}`, `/en/admin/users/${member.id}`]) {
    const r = await p.goto(path);
    expect(r?.status(), path).toBe(404);
    await expect(p.getByRole("heading", { level: 1 }), path).toHaveText(t("errors.notFoundTitle"));
    await expect(p.locator("header.admin-header"), path).toBeVisible();
  }
  await listPage(p, `?q=${encodeURIComponent(member.email)}`);
  await expect(rows(p)).toHaveCount(0);

  // Members → New account with an admin's email is refused.
  await p.goto("/en/admin/members/new");
  await expect(p.locator("#n-role")).toHaveCount(0);
  await p.locator("#n-name").fill(uniqueName("Created"));
  await p.locator("#n-email").fill(admin.email);
  await p.locator("main form").getByRole("button", { name: t("adminMembers.createButton") }).click();
  await expect(p.locator("main .alert-danger")).toHaveText(t("adminMembers.err_emailTaken"));
  expect(await userById(admin.id)).toMatchObject({ role: "admin", adminRoleId: admin.roleId });

  // A forged role=admin on Members → New account still creates a guest.
  const email = uniqueEmail();
  await p.goto("/en/admin/members/new");
  await p.locator("#n-name").fill(uniqueName("Created"));
  await p.locator("#n-email").fill(email);
  await p.locator("main form", { has: p.locator("#n-email") }).evaluate((f) => {
    const i = document.createElement("input"); i.type = "hidden"; i.name = "role"; i.value = "admin"; f.appendChild(i);
  });
  await p.locator("main form").getByRole("button", { name: t("adminMembers.createButton") }).click();
  await expect(p.locator("main .alert-success")).toBeVisible();
  expect(await userByEmail(email)).toMatchObject({ role: "guest", adminRoleId: null });
});
