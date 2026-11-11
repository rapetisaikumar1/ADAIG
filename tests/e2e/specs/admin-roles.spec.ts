/**
 * Admin → Roles (round 7, SPEC_R7 §3–§5.3, §9.2): the roles list, create / edit / delete with the permission matrix,
 * validation, permission edits reaching signed-in holders on their next request, the protected Super Admin system role,
 * roles in use, and privilege escalation (UI with disabled checkboxes forced on, and server actions posted directly with
 * forged form data).
 *
 * Forged posts: redirect-style actions (deleteRole, the Users actions) are replayed as a no-JavaScript form post
 * ($ACTION_ID_… + fields). useActionState actions (createRole, updateRole, resetAdminUserPassword, createAdminUser) are
 * replayed the same way from the form's progressive-enhancement fields ($ACTION_REF_…/$ACTION_KEY + fields), or by altering
 * the DOM of the real form and submitting it. Every check ends with a DB assertion.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import {
  auditRows, count, createAdmin, createAdminRole, createUser, e2eId, q, roleById, roleByName, userByEmail, userById, uniqueEmail, uniqueName,
  uniquePassword, SUPER_ADMIN_NAME, SUPER_ADMIN_ROLE_ID,
} from "../support/db";
import { t, re } from "../support/i18n";

const tr = (k: string, v?: Record<string, string | number>) => t(`adminRoles.${k}`, v);
const tu = (k: string, v?: Record<string, string | number>) => t(`adminUsers.${k}`, v);
const SUPER = SUPER_ADMIN_ROLE_ID;
const ALL = ["view", "create", "edit", "delete"] as const;

/* ── helpers ───────────────────────────────────────────────────────────────────── */

type Entries = [string, string][];
/** The fields the form would post (FormData order, repeated keys kept: one "perm" entry per ticked checkbox). */
const formEntries = (form: Locator) =>
  form.evaluate((f: HTMLFormElement) => Array.from(new FormData(f).entries()).map(([k, v]) => [k, String(v)] as [string, string]));
/** Replace every entry named `k` with one entry `k=v`. */
const withEntry = (e: Entries, k: string, v: string): Entries => [...e.filter(([x]) => x !== k), [k, v]];
/** POST the entries as multipart/form-data (a no-JavaScript form submission) without following redirects. */
const post = (ctx: APIRequestContext, path: string, entries: Entries) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return ctx.post(path, { multipart: fd, maxRedirects: 0 });
};
const hasActionField = (e: Entries) => e.some(([k]) => k.startsWith("$ACTION_"));
/** Set a form control's value in the DOM (hidden inputs included). */
const setValue = (l: Locator, v: string) => l.evaluate((el, val) => { (el as HTMLInputElement).value = val; }, v);

/** The create / edit role form (the one holding the name field). */
const roleForm = (p: Page) => p.locator("main form", { has: p.locator("#r-name") });
/** The delete form in the danger zone (#delete is the form itself or the section around it). */
const deleteForm = (p: Page) => p.locator("form#delete, #delete form").first();
const perm = (p: Page, m: string, a: string) => p.locator(`#perm-${m}-${a}`);
/** A form error: the form-level alert (role=alert) or a field message (.error-msg, linked by aria-describedby). */
const expectFormError = (p: Page, text: string) => expect(p.locator("main").locator("[role=alert], .error-msg").filter({ hasText: text }).first()).toBeVisible();
/** A ?msg= notice after a redirect. */
const expectNotice = (p: Page, text: string) => expect(p.locator("main .alert").filter({ hasText: text }).first()).toBeVisible();
const sidebar = (p: Page) => p.locator(".adm-side nav.adm-sidenav a");
const NAV = (mods: string[]) => mods.map((m) => re(t(`adminNav.${m}`)));
const newRoleId = (url: string) => /\/admin\/roles\/([^/?#]+)\?msg=msg_created/.exec(url)?.[1] ?? "";
const superRow = () => roleById(SUPER);

/* ── list ──────────────────────────────────────────────────────────────────────── */

test("roles list: Super Admin first with the System badge, a level per module, user counts linking to Users", async ({ adminPage: p }) => {
  // Full / Custom / View / None in module order (members, events, messages, users, roles, system).
  const role = await createAdminRole({ permissions: { members: ALL, events: ["view", "edit"], messages: ["view"] }, description: "E2E list check" });
  await createUser({ role: "admin", adminRoleId: role.id });
  await createUser({ role: "admin", adminRoleId: role.id });
  const unused = await createAdminRole({ permissions: {} });

  await p.goto("/en/admin/roles");
  await expect(p.locator("main#main h1").first()).toHaveText(tr("title"));
  await expect(sidebar(p).filter({ hasText: t("adminNav.roles") })).toHaveAttribute("aria-current", "page");
  await expect(p.locator("main").getByRole("link", { name: tr("newRole") })).toHaveAttribute("href", "/en/admin/roles/new");

  const rows = p.locator("main tbody tr");
  await expect(rows.first()).toContainText(SUPER_ADMIN_NAME); // isSystem first
  await expect(rows.first()).toContainText(tr("system"));
  await expect(rows.first().locator(`a[href="/en/admin/roles/${SUPER}"]`).first()).toBeVisible();

  const row = rows.filter({ hasText: role.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("E2E list check");
  await expect(row).not.toContainText(tr("system"));
  const cell = (r: Locator, m: string) => r.locator(`td[data-label="${tr(`mod_${m}`)}"]`);
  for (const [m, lvl] of [["members", "full"], ["events", "custom"], ["messages", "view"], ["users", "none"], ["roles", "none"], ["system", "none"]])
    await expect(cell(row, m), m).toContainText(tr(`lvl_${lvl}`));
  await expect(cell(row, "events")).toContainText(`${tr("act_view")}, ${tr("act_edit")}`); // a Custom level lists its actions
  await expect(row.locator(`a[href="/en/admin/users?role=${role.id}"]`)).toHaveText(/2 users/);
  await expect(row.locator(`a[href="/en/admin/roles/${role.id}"]`).first()).toBeVisible();

  const emptyRow = rows.filter({ hasText: unused.name });
  await expect(emptyRow).toContainText(/No users/);
  await expect(emptyRow).not.toContainText(tr("lvl_full"));
});

/* ── create / edit / delete ────────────────────────────────────────────────────── */

test("create a role with a description and permission matrix, edit it, delete it @smoke", async ({ adminPage: p }) => {
  const name = uniqueName("Role");
  await p.goto("/en/admin/roles/new");
  await p.locator("#r-name").fill(name);
  await p.locator("#r-desc").fill("Created by the E2E suite.");
  // The matrix: a checkbox per applicable module × action; not-applicable cells have none.
  for (const [m, a] of [["messages", "create"], ["messages", "delete"], ["users", "delete"], ["system", "create"], ["system", "delete"]])
    await expect(perm(p, m, a), `${m}:${a}`).toHaveCount(0);
  for (const a of ALL) await expect(perm(p, "members", a)).toBeEnabled(); // the Super Admin holds everything
  await expect(perm(p, "members", "edit")).toHaveAttribute("name", "perm");
  await expect(perm(p, "members", "edit")).toHaveAttribute("value", "members:edit");
  // Members: Edit only (View is implied), Events: View.
  await perm(p, "members", "edit").check();
  await perm(p, "events", "view").check();
  await roleForm(p).getByRole("button", { name: tr("create") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/roles\/[^/?]+\?msg=msg_created/);
  await expectNotice(p, tr("msg_created"));
  const id = newRoleId(p.url());
  const created = (await roleById(id))!;
  expect(created).toMatchObject({ name, description: "Created by the E2E suite.", isSystem: false });
  expect(created.permissions).toEqual({ members: ["view", "edit"], events: ["view"] });
  expect(await auditRows({ action: "admin_role.created", target: id })).toHaveLength(1);

  // The list summarises it: Members Custom, Events View, no users.
  await p.goto("/en/admin/roles");
  const row = p.locator("main tbody tr", { hasText: name });
  await expect(row.locator(`td[data-label="${tr("mod_members")}"]`)).toContainText(tr("lvl_custom"));
  await expect(row.locator(`td[data-label="${tr("mod_events")}"]`)).toContainText(tr("lvl_view"));
  await expect(row.locator(`td[data-label="${tr("mod_messages")}"]`)).toContainText(tr("lvl_none"));
  await expect(row).toContainText(/No users/);

  // Edit: the form is prefilled (implied View ticked); rename, new description, Members Edit → off + Messages View on.
  await row.locator(`a[href="/en/admin/roles/${id}"]`).first().click();
  await expect(p).toHaveURL(new RegExp(`/en/admin/roles/${id}$`));
  await expect(p.locator("#r-name")).toHaveValue(name);
  await expect(p.locator("#r-desc")).toHaveValue("Created by the E2E suite.");
  await expect(perm(p, "members", "view")).toBeChecked();
  await expect(perm(p, "members", "edit")).toBeChecked();
  await expect(perm(p, "events", "view")).toBeChecked();
  await expect(perm(p, "members", "delete")).not.toBeChecked();
  const renamed = `${name} renamed`;
  await p.locator("#r-name").fill(renamed);
  await p.locator("#r-desc").fill("Edited by the E2E suite.");
  await perm(p, "members", "edit").uncheck();
  await perm(p, "messages", "view").check();
  await roleForm(p).getByRole("button", { name: tr("save") }).click();
  await expect(p).toHaveURL(new RegExp(`/en/admin/roles/${id}\\?msg=msg_saved`));
  await expectNotice(p, tr("msg_saved"));
  const edited = (await roleById(id))!;
  expect(edited).toMatchObject({ name: renamed, description: "Edited by the E2E suite." });
  expect(edited.permissions).toEqual({ members: ["view"], events: ["view"], messages: ["view"] });
  expect(await auditRows({ action: "admin_role.updated", target: id })).toHaveLength(1);
  expect(await auditRows({ action: "admin_role.permissions_changed", target: id })).toHaveLength(1);

  // Delete (unused): confirm box + button → back to the list.
  await p.goto(`/en/admin/roles/${id}`);
  await deleteForm(p).locator("input[name=confirm]").check();
  await deleteForm(p).getByRole("button", { name: tr("deleteButton") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/roles\?msg=msg_deleted/);
  await expectNotice(p, tr("msg_deleted"));
  await expect(p.locator("main tbody tr", { hasText: renamed })).toHaveCount(0);
  expect(await roleById(id)).toBeUndefined();
  expect(await auditRows({ action: "admin_role.deleted", target: id })).toHaveLength(1);
});

test("validation: empty or one-letter name, duplicate names (any case, incl. Super Admin), description too long", async ({ adminPage: p }) => {
  const existing = await createAdminRole({ permissions: { members: ["view"] } });
  const before = await count(`SELECT count(*) AS n FROM "AdminRole"`);
  await p.goto("/en/admin/roles/new");
  await perm(p, "members", "view").check();
  // Let the browser submit what the server must refuse (re-applied before every submit, in case the form re-renders).
  const strip = async () => {
    await p.locator("#r-name").evaluate((el) => { for (const a of ["required", "minlength", "maxlength", "pattern"]) el.removeAttribute(a); });
    await p.locator("#r-desc").evaluate((el) => el.removeAttribute("maxlength"));
  };
  const submit = async () => { await strip(); await roleForm(p).getByRole("button", { name: tr("create") }).click(); };

  for (const bad of ["", "   ", "A"]) {
    await strip();
    await p.locator("#r-name").fill(bad);
    await submit();
    await expectFormError(p, tr("err_name"));
  }
  for (const dup of ["super admin", "SUPER ADMIN", SUPER_ADMIN_NAME, existing.name.toUpperCase(), existing.name.toLowerCase()]) {
    await p.locator("#r-name").fill(dup);
    await submit();
    await expectFormError(p, tr("err_nameTaken"));
    await expect(p.locator("#r-name"), "what was typed is kept").toHaveValue(dup);
    await expect(perm(p, "members", "view"), "ticked permissions are kept").toBeChecked();
  }
  const fresh = uniqueName("Role");
  await p.locator("#r-name").fill(fresh);
  await strip();
  await p.locator("#r-desc").fill("x".repeat(301));
  await expect(p.locator("#r-desc")).toHaveValue("x".repeat(301));
  await submit();
  await expectFormError(p, tr("err_description"));
  await expect(p).toHaveURL(/\/en\/admin\/roles\/new$/);
  expect(await count(`SELECT count(*) AS n FROM "AdminRole"`)).toBe(before);
  expect(await roleByName(fresh)).toBeUndefined();
  expect(await count(`SELECT count(*) AS n FROM "AdminRole" WHERE lower(name) = 'super admin'`)).toBe(1);
  // 300 characters is fine.
  await p.locator("#r-desc").fill("y".repeat(300));
  await submit();
  await expect(p).toHaveURL(/msg=msg_created/);
  expect((await roleByName(fresh))!.description).toBe("y".repeat(300));
});

test("role names: lookalikes of existing roles, hidden characters and mixed alphabets are refused (S5)", async ({ adminPage: p }) => {
  const existing = await createAdminRole({ permissions: { members: ["view"] }, name: `E2E Look ${Date.now().toString(36)}` });
  const before = await count(`SELECT count(*) AS n FROM "AdminRole"`);
  await p.goto("/en/admin/roles/new");
  await perm(p, "members", "view").check();
  const submit = async (name: string) => {
    await p.locator("#r-name").evaluate((el) => { for (const a of ["required", "minlength", "maxlength", "pattern"]) el.removeAttribute(a); });
    await p.locator("#r-name").fill(name);
    await roleForm(p).getByRole("button", { name: tr("create") }).click();
  };
  // Hidden/format characters and Latin mixed with Cyrillic or Greek (the SEC L-4 repros first).
  for (const bad of ["Super Adm\u0456n", "Super\u200BAdmin", "Super\u200DAdmin", "\u202ESuper Admin", "Super \u0391dmin", "Viewer\u00AD"]) {
    await submit(bad);
    await expectFormError(p, tr("err_nameChars"));
  }
  // Same name after NFKC (fullwidth letters, no-break space) → taken.
  for (const dup of ["\uFF33\uFF55\uFF50\uFF45\uFF52 \uFF21\uFF44\uFF4D\uFF49\uFF4E", "Super\u00A0Admin"]) {
    await submit(dup);
    await expectFormError(p, tr("err_nameTaken"));
  }
  // Lookalike skeletons (spacing, separators, digits for letters, rn for m, accents, small capitals) → too similar.
  for (const [look, of] of [["SuperAdmin", SUPER_ADMIN_NAME], ["Super-Admin", SUPER_ADMIN_NAME], ["Super Adm1n", SUPER_ADMIN_NAME], ["Super Adrnin", SUPER_ADMIN_NAME],
    ["Sup\u00E9r Admin", SUPER_ADMIN_NAME], ["\uA731\u1D1C\u1D18\u1D07\u0280 \u1D00\u1D05\u1D0D\u026A\u0274", SUPER_ADMIN_NAME], [existing.name.replace(/ /g, "_"), existing.name]] as const) {
    await submit(look);
    await expectFormError(p, tr("err_nameSimilar", { name: of }));
  }
  expect(await count(`SELECT count(*) AS n FROM "AdminRole"`), "nothing was created").toBe(before);

  // Renaming an existing role to a lookalike is refused the same way; keeping its own name is fine.
  const mine = await createAdminRole({ permissions: { members: ["view"] } });
  await p.goto(`/en/admin/roles/${mine.id}`);
  await p.locator("#r-name").fill("Super_Admin");
  await roleForm(p).getByRole("button", { name: tr("save") }).click();
  await expectFormError(p, tr("err_nameSimilar", { name: SUPER_ADMIN_NAME }));
  expect((await roleById(mine.id))!.name).toBe(mine.name);
  await p.goto(`/en/admin/roles/${mine.id}`);
  await p.locator("#r-desc").fill("Unchanged name, new description");
  await roleForm(p).getByRole("button", { name: tr("save") }).click();
  await expect(p).toHaveURL(/msg=msg_saved/);
});

/* ── permission edits reach signed-in holders ───────────────────────────────────── */

test("editing a role's permissions changes what its signed-in users can do on their next request (no re-login)", async ({ adminPage: p, loginAs }) => {
  const role = await createAdminRole({ permissions: { members: ["view"], events: ["view"], messages: ["view"] } });
  const u = await createUser({ role: "admin", adminRoleId: role.id });
  const msgText = `E2E role edit inbox ${uniqueName("Msg")}`;
  await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', $3, 'en')`, [e2eId(), uniqueEmail(), msgText]);

  const s = await loginAs(u, { expectUrl: /\/en\/admin\/members$/ });
  await expect(sidebar(s)).toHaveText(NAV(["members", "events", "messages"]));
  await s.goto("/en/admin/messages");
  const item = s.locator("li.inbox-item", { hasText: msgText });
  await expect(item).toBeVisible();
  await expect(item.locator("form")).toHaveCount(0); // no messages.edit yet
  expect((await s.request.get("/api/admin/registrations.csv")).status()).toBe(200);
  const sv = (await userById(u.id))!.sessionVersion;

  // Super Admin: Events off, Messages Edit on.
  await p.goto(`/en/admin/roles/${role.id}`);
  await perm(p, "events", "view").uncheck();
  await perm(p, "messages", "edit").check();
  await roleForm(p).getByRole("button", { name: tr("save") }).click();
  await expect(p).toHaveURL(/msg=msg_saved/);
  expect((await roleById(role.id))!.permissions).toEqual({ members: ["view"], messages: ["view", "edit"] });

  // The user's very next request uses the new permissions; the session survives (no sessionVersion bump for role edits).
  await s.goto("/en/admin/members");
  await expect(s).toHaveURL(/\/en\/admin\/members$/);
  await expect(sidebar(s)).toHaveText(NAV(["members", "messages"]));
  await s.goto("/en/admin/events");
  await expect(s).toHaveURL(/\/en\/admin\/no-access$/);
  await expect(s.getByRole("heading", { name: t("admin.noAccessTitle") })).toBeVisible();
  expect((await s.request.get("/api/admin/registrations.csv")).status()).toBe(403);
  await s.goto("/en/admin/messages");
  await expect(s.locator("li.inbox-item", { hasText: msgText }).locator("form")).toHaveCount(1); // Mark handled now offered
  expect((await userById(u.id))!.sessionVersion).toBe(sv);

  // And back: Events View again → the link returns.
  await p.goto(`/en/admin/roles/${role.id}`);
  await perm(p, "events", "view").check();
  await roleForm(p).getByRole("button", { name: tr("save") }).click();
  await expect(p).toHaveURL(/msg=msg_saved/);
  await s.goto("/en/admin/events");
  await expect(s).toHaveURL(/\/en\/admin\/events$/);
  await expect(sidebar(s)).toHaveText(NAV(["members", "events", "messages"]));
});

/* ── Super Admin ───────────────────────────────────────────────────────────────── */

test("Super Admin can't be edited, renamed or deleted (read-only page; forged update and delete are refused)", async ({ adminPage: p }) => {
  const before = (await superRow())!;
  expect(before).toMatchObject({ name: SUPER_ADMIN_NAME, isSystem: true });

  await p.goto(`/en/admin/roles/${SUPER}`);
  await expect(p.locator("main")).toContainText(tr("superNote"));
  // Read-only matrix: every applicable cell ticked and disabled; nothing is submitted (no form, no save).
  await expect(p.locator('main input[id^="perm-"]')).toHaveCount(19); // members 4, events 4, messages 2, users 3, roles 4, system 2
  await expect(p.locator('main input[id^="perm-"]:not([disabled])')).toHaveCount(0);
  await expect(p.locator('main input[id^="perm-"]:not(:checked)')).toHaveCount(0);
  await expect(p.locator("main form", { has: p.locator("#r-name") })).toHaveCount(0);
  await expect(p.locator("main").getByRole("button", { name: tr("save") })).toHaveCount(0);
  await expect(p.locator("main").getByRole("button", { name: tr("deleteButton") })).toHaveCount(0);

  // Forged update through another role's real form, re-pointed at the Super Admin role (DOM change + normal submit).
  const other = await createAdminRole({ permissions: { members: ["view"] } });
  // The id is forged last: ticking a checkbox re-renders the form, and React puts its controlled hidden id input back.
  await p.goto(`/en/admin/roles/${other.id}`);
  await p.locator("#r-name").fill(uniqueName("Hijacked"));
  await perm(p, "events", "view").check();
  await setValue(roleForm(p).locator("input[name=id]"), SUPER);
  await expect(roleForm(p).locator("input[name=id]")).toHaveValue(SUPER);
  await roleForm(p).getByRole("button", { name: tr("save") }).click();
  await expectFormError(p, tr("err_systemRole"));

  // Forged update posted directly (the form's own progressive-enhancement fields, id + name + permissions forged).
  await p.goto(`/en/admin/roles/${other.id}`);
  let e = await formEntries(roleForm(p));
  expect(hasActionField(e)).toBe(true);
  e = withEntry(withEntry(withEntry(e, "id", SUPER), "name", "E2E Renamed Super"), "perm", "members:view");
  const r1 = await post(p.request, `/en/admin/roles/${other.id}`, e);
  expect(r1.status()).toBeLessThan(500);

  // Forged delete: the other role's delete form re-pointed at the Super Admin role, in the DOM and as a direct post.
  await p.goto(`/en/admin/roles/${other.id}`);
  await setValue(deleteForm(p).locator("input[name=id]"), SUPER);
  await deleteForm(p).locator("input[name=confirm]").check();
  const del = withEntry(await formEntries(deleteForm(p)), "confirm", "on");
  await deleteForm(p).getByRole("button", { name: tr("deleteButton") }).click();
  await expect(p).toHaveURL(/msg=err_systemRole/);
  await expectNotice(p, tr("err_systemRole"));
  const r2 = await post(p.request, `/en/admin/roles/${other.id}`, del);
  expect(r2.status()).toBe(303);
  expect(r2.headers()["location"]).toMatch(/msg=err_systemRole/);

  const after = (await superRow())!;
  expect(after).toMatchObject({ name: before.name, description: before.description, isSystem: true });
  expect(after.permissions).toEqual(before.permissions);
  expect(+after.updatedAt).toBe(+before.updatedAt);
  expect((await roleById(other.id))!.permissions).toEqual({ members: ["view"] }); // the carrier role was not touched either
  expect(await count(`SELECT count(*) AS n FROM "AdminRole" WHERE name LIKE 'E2E Hijacked%' OR name = 'E2E Renamed Super'`)).toBe(0);
});

/* ── roles in use ──────────────────────────────────────────────────────────────── */

test("a role in use can't be deleted (UI and forged post); an unused role can", async ({ adminPage: p }) => {
  const used = await createAdminRole({ permissions: { members: ["view"] } });
  const holder = await createUser({ role: "admin", adminRoleId: used.id });
  const unused = await createAdminRole({ permissions: { events: ["view"] } });

  await p.goto(`/en/admin/roles/${used.id}`);
  const zone = p.locator("#delete");
  await expect(zone).toContainText(/1 user has this role/);
  await expect(zone.getByRole("link", { name: tr("viewUsers") })).toHaveAttribute("href", `/en/admin/users?role=${used.id}`);
  const btn = zone.getByRole("button", { name: tr("deleteButton") });
  if (await btn.count()) await expect(btn).toBeDisabled();

  // Forged: the unused role's delete form re-pointed at the role in use (direct post, then the DOM route).
  await p.goto(`/en/admin/roles/${unused.id}`);
  await deleteForm(p).locator("input[name=confirm]").check();
  const fields = withEntry(withEntry(await formEntries(deleteForm(p)), "id", used.id), "confirm", "on");
  expect(hasActionField(fields)).toBe(true);
  const r = await post(p.request, `/en/admin/roles/${unused.id}`, fields);
  expect(r.status()).toBe(303);
  expect(r.headers()["location"]).toMatch(/msg=err_inUse/);
  await setValue(deleteForm(p).locator("input[name=id]"), used.id);
  await deleteForm(p).getByRole("button", { name: tr("deleteButton") }).click();
  await expect(p).toHaveURL(new RegExp(`/en/admin/roles/${used.id}\\?msg=err_inUse`));
  await expectNotice(p, tr("err_inUse"));
  expect(await roleById(used.id)).toBeDefined();
  expect((await userById(holder.id))!.adminRoleId).toBe(used.id);
  expect((await auditRows({ action: "admin_role.delete_blocked_in_use", target: used.id })).length).toBeGreaterThanOrEqual(2);

  // Without the confirmation box: refused.
  await p.goto(`/en/admin/roles/${unused.id}`);
  const noConfirm = (await formEntries(deleteForm(p))).filter(([k]) => k !== "confirm");
  const r2 = await post(p.request, `/en/admin/roles/${unused.id}`, noConfirm);
  expect(r2.headers()["location"]).toMatch(/msg=err_confirm/);
  expect(await roleById(unused.id)).toBeDefined();

  // The unused role is deleted normally.
  await deleteForm(p).locator("input[name=confirm]").check();
  await deleteForm(p).getByRole("button", { name: tr("deleteButton") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/roles\?msg=msg_deleted/);
  expect(await roleById(unused.id)).toBeUndefined();
});

/* ── privilege escalation ──────────────────────────────────────────────────────── */

test.describe("no privilege escalation", () => {
  // The actor manages roles and users but holds only View on Members (no members.delete, nothing on Events).
  const ACTOR = { roles: ALL, users: ["view", "create", "edit"], members: ["view"] } as const;

  test("a role editor without members.delete can't grant it: disabled in the matrix, refused when forced on or posted", async ({ loginAs }) => {
    const actor = await createAdmin(ACTOR);
    const p = await loginAs(actor, { expectUrl: /\/en\/admin\/members$/ });
    await expect(sidebar(p)).toHaveText(NAV(["members", "users", "roles"]));

    // UI: create form. Permissions the actor lacks are disabled; the ones it holds are not.
    await p.goto("/en/admin/roles/new");
    await expect(perm(p, "members", "view")).toBeEnabled();
    for (const [m, a] of [["members", "create"], ["members", "edit"], ["members", "delete"], ["events", "view"], ["system", "view"]])
      await expect(perm(p, m, a), `${m}:${a}`).toBeDisabled();
    const blocked = uniqueName("Role");
    await p.locator("#r-name").fill(blocked);
    await perm(p, "members", "view").check();
    await perm(p, "members", "delete").evaluate((el) => { (el as HTMLInputElement).disabled = false; (el as HTMLInputElement).checked = true; });
    await roleForm(p).getByRole("button", { name: tr("create") }).click();
    await expectFormError(p, tr("err_escalation"));
    expect(await roleByName(blocked)).toBeUndefined();

    // Direct post of the create action with forged perm=members:delete (and events:edit).
    await p.goto("/en/admin/roles/new");
    const forged = uniqueName("Role");
    await p.locator("#r-name").fill(forged);
    await perm(p, "members", "view").check();
    const base = await formEntries(roleForm(p));
    expect(hasActionField(base)).toBe(true);
    const r = await post(p.request, "/en/admin/roles/new", [...base, ["perm", "members:delete"], ["perm", "events:edit"]]);
    expect(r.status()).toBeLessThan(400);
    expect(await roleByName(forged)).toBeUndefined();
    // Control: the same post without the forged permissions creates the role, so the refusal above is the escalation check.
    const ok = await post(p.request, "/en/admin/roles/new", base);
    expect(ok.status()).toBe(303);
    expect((await roleByName(forged))!.permissions).toEqual({ members: ["view"] });

    // UI + direct post: editing a role the actor may manage can't add members.delete either.
    const managed = await createAdminRole({ permissions: { members: ["view"] } });
    await p.goto(`/en/admin/roles/${managed.id}`);
    await expect(perm(p, "members", "delete")).toBeDisabled();
    const editBase = await formEntries(roleForm(p));
    await perm(p, "members", "delete").evaluate((el) => { (el as HTMLInputElement).disabled = false; (el as HTMLInputElement).checked = true; });
    await roleForm(p).getByRole("button", { name: tr("save") }).click();
    await expectFormError(p, tr("err_escalation"));
    const r2 = await post(p.request, `/en/admin/roles/${managed.id}`, [...editBase, ["perm", "members:delete"]]);
    expect(r2.status()).toBeLessThan(400);
    const m = (await roleById(managed.id))!;
    expect(m.permissions).toEqual({ members: ["view"] });
    expect(m.name).toBe(managed.name);
    expect(await auditRows({ action: "admin_role.updated", target: managed.id })).toHaveLength(0);
  });

  test("own role and roles with more permissions can't be changed or deleted", async ({ loginAs }) => {
    const actor = await createAdmin(ACTOR);
    const stronger = await createAdminRole({ permissions: { events: ["view"] } }); // something the actor doesn't hold
    const managed = await createAdminRole({ permissions: { members: ["view"] } });
    const p = await loginAs(actor, { expectUrl: /\/en\/admin\/members$/ });

    // Read-only pages with the matching note, no save / delete.
    for (const [id, note] of [[actor.roleId, tr("ownRoleNote")], [stronger.id, tr("targetNote")]] as const) {
      await p.goto(`/en/admin/roles/${id}`);
      await expect(p.locator("main"), id).toContainText(note);
      await expect(p.locator("main").getByRole("button", { name: tr("save") }), id).toHaveCount(0);
      await expect(p.locator("main").getByRole("button", { name: tr("deleteButton") }), id).toHaveCount(0);
    }

    // Forged updates: the managed role's form re-pointed at the own role and at the stronger role.
    for (const [id, err] of [[actor.roleId, "err_ownRole"], [stronger.id, "err_target"]] as const) {
      await p.goto(`/en/admin/roles/${managed.id}`);
      await p.locator("#r-name").fill(uniqueName("Role"));
      await setValue(roleForm(p).locator("input[name=id]"), id); // last, so no re-render can restore the controlled value
      await roleForm(p).getByRole("button", { name: tr("save") }).click();
      await expectFormError(p, tr(err));
    }
    // Forged deletes (direct posts of the managed role's delete form).
    await p.goto(`/en/admin/roles/${managed.id}`);
    await deleteForm(p).locator("input[name=confirm]").check();
    const del = withEntry(await formEntries(deleteForm(p)), "confirm", "on");
    for (const [id, err] of [[actor.roleId, "err_ownRole"], [stronger.id, "err_target"], [SUPER, "err_systemRole"]] as const) {
      const r = await post(p.request, `/en/admin/roles/${managed.id}`, withEntry(del, "id", id));
      expect(r.status(), id).toBe(303);
      expect(r.headers()["location"], id).toMatch(new RegExp(`msg=${err}`));
    }
    expect((await roleById(actor.roleId))!.permissions).toEqual({ roles: [...ALL], users: ["view", "create", "edit"], members: ["view"] });
    expect((await roleById(stronger.id))!.permissions).toEqual({ events: ["view"] });
    expect(await roleById(managed.id)).toBeDefined();
  });

  test("assigning roles: only roles within the actor's permissions are offered; Super Admin and stronger roles are refused", async ({ loginAs }) => {
    const actor = await createAdmin(ACTOR);
    const weaker = await createAdminRole({ permissions: { members: ["view"] } });
    const memberManagerLike = await createAdminRole({ permissions: { members: ALL, events: ["view"], messages: ["view"] } });
    const p = await loginAs(actor, { expectUrl: /\/en\/admin\/members$/ });

    await p.goto("/en/admin/users/new");
    const select = p.locator("#u-role");
    await expect(select.locator(`option[value="${weaker.id}"]`)).toHaveCount(1);
    await expect(select.locator(`option[value="${actor.roleId}"]`)).toHaveCount(1); // own permissions: allowed
    await expect(select.locator(`option[value="${SUPER}"]`)).toHaveCount(0);
    await expect(select.locator(`option[value="${memberManagerLike.id}"]`)).toHaveCount(0);

    const form = p.locator("main form", { has: p.locator("#u-email") });
    for (const [roleId, err] of [[SUPER, "err_superOnly"], [memberManagerLike.id, "err_roleNotAllowed"]] as const) {
      const email = uniqueEmail(); const pw = uniquePassword();
      await p.goto("/en/admin/users/new");
      await p.locator("#u-name").fill(uniqueName("Escalation"));
      await p.locator("#u-email").fill(email);
      await p.locator("#u-pw").fill(pw);
      await p.locator("#u-pw2").fill(pw);
      await select.evaluate((s, v) => { const el = s as HTMLSelectElement; el.add(new Option(v, v)); el.value = v; }, roleId);
      await form.getByRole("button", { name: tu("createButton") }).click();
      await expectFormError(p, tu(err));
      // Direct post of the same form.
      const e = withEntry(await formEntries(form), "password", pw);
      const r = await post(p.request, "/en/admin/users/new", withEntry(withEntry(e, "confirm", pw), "roleId", roleId));
      expect(r.status(), roleId).toBeLessThan(400);
      expect(await userByEmail(email), roleId).toBeUndefined();
    }
  });

  test("a Super Admin user can't be re-roled, deactivated or have the password reset by a non-Super Admin", async ({ loginAs }) => {
    const actor = await createAdmin(ACTOR);
    const sa = await createUser({ role: "admin" }); // an e2e Super Admin (never touch the seed admins' sessions)
    const weaker = await createAdminRole({ permissions: { members: ["view"] } });
    const managed = await createUser({ role: "admin", adminRoleId: weaker.id });
    const saBefore = (await userById(sa.id))!;
    const p = await loginAs(actor, { expectUrl: /\/en\/admin\/members$/ });

    // The Super Admin's page: a note, no role / status / password controls.
    await p.goto(`/en/admin/users/${sa.id}`);
    await expect(p.locator("main")).toContainText(tu("superNote"));
    await expect(p.locator("main").getByRole("button", { name: tu("changeRole") })).toHaveCount(0);
    await expect(p.locator("main").getByRole("button", { name: tu("pwButton") })).toHaveCount(0);
    await expect(p.locator("main summary, main button").filter({ hasText: tu("deactivate") })).toHaveCount(0);

    // Forged: the managed user's forms re-pointed at the Super Admin (uid).
    await p.goto(`/en/admin/users/${managed.id}`);
    const roleFields = await formEntries(p.locator("#role form").first());
    const statusFields = await formEntries(p.locator("#status form", { has: p.locator("input[name=to]") }).first());
    const pwForm = p.locator("main form", { has: p.locator("input[name=password]") });
    const pwFields = await formEntries(pwForm);
    for (const f of [roleFields, statusFields, pwFields]) expect(hasActionField(f)).toBe(true);
    const rr = await post(p.request, `/en/admin/users/${managed.id}`, withEntry(withEntry(roleFields, "uid", sa.id), "roleId", weaker.id));
    expect(rr.status()).toBe(303);
    expect(rr.headers()["location"]).toMatch(/msg=err_superOnly/);
    const rs = await post(p.request, `/en/admin/users/${managed.id}`, withEntry(withEntry(withEntry(statusFields, "uid", sa.id), "to", "inactive"), "confirm", "on"));
    expect(rs.status()).toBe(303);
    expect(rs.headers()["location"]).toMatch(/msg=err_superOnly/);
    const newPw = uniquePassword();
    const rp = await post(p.request, `/en/admin/users/${managed.id}`, withEntry(withEntry(withEntry(pwFields, "uid", sa.id), "password", newPw), "confirm", newPw));
    expect(rp.status()).toBeLessThan(400);
    // The same password reset through the real form with the uid changed in the DOM.
    await pwForm.locator("input[name=password]").fill(newPw);
    await pwForm.locator("input[name=confirm]").fill(newPw);
    await setValue(pwForm.locator("input[name=uid]"), sa.id); // last, so no re-render can restore the controlled value
    await pwForm.getByRole("button", { name: tu("pwButton") }).click();
    await expectFormError(p, tu("err_superOnly"));

    const saAfter = (await userById(sa.id))!;
    expect(saAfter).toMatchObject({ role: "admin", active: true, adminRoleId: SUPER, passwordHash: saBefore.passwordHash, sessionVersion: saBefore.sessionVersion });
  });
});
