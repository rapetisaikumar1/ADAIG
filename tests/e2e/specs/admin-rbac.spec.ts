/**
 * RBAC enforcement (round 7, SPEC_R7 §3.2, §4, §5.5, §7, §9.2): for each example role (Member Manager, Event Manager, Viewer)
 * and a role with no permissions: the sidebar shows exactly the permitted modules, forbidden pages redirect to /admin/no-access
 * by direct URL, buttons for missing actions are absent. Server actions refuse forged submissions (replayed form posts and a
 * form re-targeted in the DOM to another action id) with the DB unchanged; CSV/API routes answer 403; deactivated accounts are
 * blocked everywhere; the admin home follows the role; Members and Admin Portal accounts are kept apart (Members list, CSV and
 * actions; /join for admins, Q4); the member portal is unaffected.
 *
 * Roles are created per test with createAdmin(ROLE_PRESETS.…) (mirrors of the seeded examples), never the seeded rows.
 * Expected landings and visibility are written out here, not derived from the app's own permission helpers.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, expectLoginRefused } from "../fixtures";
import {
  auditRows, createAdmin, createEvent, createMember, createMembership, createUser, e2eId, eventById, eventByTitle, membershipsOf, one, q,
  roleByName, setActive, userByEmail, userById, uniqueEmail, uniqueName, uniquePassword, ROLE_PRESETS, RUN, SUPER_ADMIN_ROLE_ID,
} from "../support/db";
import { SEED } from "../support/env";
import { t, re } from "../support/i18n";

const ta = (k: string, v?: Record<string, string | number>) => t(`admin.${k}`, v);
const tm = (k: string, v?: Record<string, string | number>) => t(`adminMembers.${k}`, v);
const te = (k: string, v?: Record<string, string | number>) => t(`adminEvents.${k}`, v);
const enc = encodeURIComponent;

type Perms = Record<string, readonly string[]>;
const can = (p: Perms, m: string, a: string) => !!p[m]?.includes(a);
const n = (b: boolean) => (b ? 1 : 0);

/* ── the roles under test ──────────────────────────────────────────────────────── */

/** `noAccess`: the no-access page heading (a role without any tool gets its own wording). */
type Case = { label: string; perms: Perms; nav: string[]; home: string; noAccess: string };
const CASES: Case[] = [
  { label: "Member Manager", perms: ROLE_PRESETS.memberManager, nav: ["members", "events", "messages"], home: "/en/admin/members", noAccess: "admin.noAccessTitle" },
  { label: "Event Manager", perms: ROLE_PRESETS.eventManager, nav: ["members", "events", "messages"], home: "/en/admin/members", noAccess: "admin.noAccessTitle" },
  { label: "Viewer", perms: ROLE_PRESETS.viewer, nav: ["members", "events", "messages"], home: "/en/admin/members", noAccess: "admin.noAccessTitle" },
  { label: "No permissions", perms: ROLE_PRESETS.none, nav: [], home: "/en/admin/no-access", noAccess: "admin.noAccessNoneTitle" },
];
const homeRe = (home: string) => new RegExp(`${home.replace(/[/]/g, "\\/")}$`);

/** Every admin page and the permission it needs (SPEC §3.2). */
const PAGES = (ids: { member: string; event: string; admin: string }): [string, string, string][] => [
  ["/en/admin/members", "members", "view"],
  ["/en/admin/members/new", "members", "create"],
  [`/en/admin/members/${ids.member}`, "members", "view"],
  ["/en/admin/events", "events", "view"],
  [`/en/admin/events/${ids.event}`, "events", "view"],
  ["/en/admin/messages", "messages", "view"],
  ["/en/admin/users", "users", "view"],
  ["/en/admin/users/new", "users", "create"],
  [`/en/admin/users/${ids.admin}`, "users", "view"],
  ["/en/admin/roles", "roles", "view"],
  ["/en/admin/roles/new", "roles", "create"],
  [`/en/admin/roles/${SUPER_ADMIN_ROLE_ID}`, "roles", "view"],
  ["/en/admin/dashboard", "system", "view"],
  ["/en/admin/settings", "system", "view"],
  ["/en/admin/audit", "system", "view"],
  ["/en/admin/system", "system", "view"],
  ["/en/admin/corporate", "system", "view"],
  ["/en/admin/chapter", "system", "view"],
];

/* ── helpers ───────────────────────────────────────────────────────────────────── */

const sidebar = (p: Page) => p.locator(".adm-side nav.adm-sidenav a");
async function expectSidebar(p: Page, mods: string[]) {
  if (mods.length) await expect(sidebar(p)).toHaveText(mods.map((m) => re(t(`adminNav.${m}`))));
  else {
    await expect(sidebar(p)).toHaveCount(0);
    await expect(p.locator(".adm-side .adm-nav-empty")).toHaveText(t("adminNav.noTools"));
  }
}
async function expectNoAccess(p: Page, path: string, heading = "admin.noAccessTitle") {
  const r = await p.goto(path);
  await expect(p, path).toHaveURL(/\/en\/admin\/no-access$/);
  expect(r?.status(), path).toBe(200);
  await expect(p.locator("main#main h1"), path).toHaveText(t(heading));
  await expect(p.locator("header.admin-header"), path).toBeVisible(); // still inside the admin shell
}
async function expectAllowed(p: Page, path: string) {
  const r = await p.goto(path);
  expect(r?.status(), path).toBe(200);
  await expect(p, path).toHaveURL(homeRe(path));
  await expect(p.locator("main#main h1").first(), path).toBeVisible();
  await expect(p.locator("main#main h1").first(), path).not.toHaveText(new RegExp(`^(${re(t("admin.noAccessTitle")).source}|${re(t("admin.noAccessNoneTitle")).source})$`));
}

type Entries = [string, string][];
const formEntries = (form: Locator) =>
  form.evaluate((f: HTMLFormElement) => Array.from(new FormData(f).entries()).map(([k, v]) => [k, String(v)] as [string, string]));
const withEntry = (e: Entries, k: string, v: string): Entries => [...e.filter(([x]) => x !== k), [k, v]];
/** A no-JavaScript form submission (multipart, redirects not followed). */
const post = (ctx: APIRequestContext, path: string, entries: Entries) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return ctx.post(path, { multipart: fd, maxRedirects: 0 });
};
const setValue = (l: Locator, v: string) => l.evaluate((el, val) => { (el as HTMLInputElement).value = val; }, v);
const addMessage = async (text: string) => {
  const id = e2eId();
  await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', $3, 'en')`, [id, uniqueEmail(), text]);
  return id;
};
const messageStatus = async (id: string) => (await one<{ status: string }>(`SELECT status FROM "ContactMessage" WHERE id = $1`, [id]))!.status;
const lock = (email: string) => q(`INSERT INTO "LoginThrottle" (key, failures, "lockedUntil") VALUES ($1, 5, now() + interval '1 hour')`, [`e:${email}`]);
const deniedTargets = async (actor: string) => (await auditRows({ action: "admin.permission_denied", actor })).map((r) => r.target ?? "").sort();
const publishForm = (p: Page, title: string) => p.locator("form", { has: p.getByRole("button", { name: `${ta("publish")}: ${title}`, exact: true }) });

/* ── sidebar, landing, direct URLs ─────────────────────────────────────────────── */

test("Super Admin: all five modules in the sidebar, /admin goes to Members", async ({ adminPage: p }) => {
  await p.goto("/en/admin");
  await expect(p).toHaveURL(/\/en\/admin\/members$/);
  await expectSidebar(p, ["members", "events", "messages", "users", "roles"]);
  await expect(p.locator("a.admin-header__brand")).toHaveAttribute("href", "/en/admin/members");
});

for (const c of CASES) {
  test(`${c.label}: the sidebar shows exactly the permitted modules; every other admin page redirects to no-access`, async ({ loginAs }) => {
    const member = await createMember(); const event = await createEvent(); const other = await createUser({ role: "admin" });
    const u = await createAdmin(c.perms);
    const p = await loginAs(u, { expectUrl: homeRe(c.home) });
    await expectSidebar(p, c.nav);
    await expect(p.locator("a.admin-header__brand")).toHaveAttribute("href", c.home);
    await p.goto("/en/admin");
    await expect(p).toHaveURL(homeRe(c.home));

    for (const [path, m, a] of PAGES({ member: member.id, event: event.id, admin: other.id })) {
      if (can(c.perms, m, a)) await expectAllowed(p, path);
      else await expectNoAccess(p, path, c.noAccess);
    }

    if (c.nav.length) {
      // Some access: the no-access page explains and links to the admin home.
      await p.goto("/en/admin/no-access");
      await expect(p.locator("main")).toContainText(ta("noAccessBody"));
      await expect(p.locator("main").getByRole("link", { name: ta("adminHome") })).toHaveAttribute("href", c.home);
    } else {
      // Empty role: lands on no-access with the "no tools" text; Profile & privacy still works inside the admin shell.
      await p.goto("/en/admin/no-access");
      await expect(p.locator("main")).toContainText(ta("noAccessNone"));
      await expect(p.locator("main").getByRole("link", { name: ta("adminHome") })).toHaveCount(0);
      await expect(p.locator(`main a[href="/en/my/profile"]`).first()).toBeVisible();
      const r = await p.goto("/en/my/profile");
      expect(r?.status()).toBe(200);
      await expect(p).toHaveURL(/\/en\/my\/profile$/);
      await expect(p.locator("header.admin-header")).toBeVisible();
      await expectSidebar(p, []);
    }
  });
}

test("admin home: login and /admin land on the first permitted module (Members, Events, Messages, Users, Roles, Overview), else no-access", async ({ loginAs }) => {
  test.setTimeout(150_000);
  const cases: [Perms, string][] = [
    [{ members: ["view"] }, "/en/admin/members"],
    [ROLE_PRESETS.eventsOnly, "/en/admin/events"],
    [{ messages: ["view", "edit"] }, "/en/admin/messages"],
    [{ users: ["view"] }, "/en/admin/users"],
    [{ roles: ["view"], users: ["view"] }, "/en/admin/users"],
    [{ roles: ["view"] }, "/en/admin/roles"],
    [{ system: ["view"] }, "/en/admin/dashboard"],
    [{ events: ["view"], system: ["view", "edit"] }, "/en/admin/events"],
    [{}, "/en/admin/no-access"],
  ];
  for (const [perms, home] of cases) {
    const label = `${JSON.stringify(perms)} → ${home}`;
    const p = await loginAs(await createAdmin(perms), { expectUrl: homeRe(home) });
    await expect(p.locator("a.admin-header__brand"), label).toHaveAttribute("href", home);
    await p.goto("/en/admin");
    await expect(p, label).toHaveURL(homeRe(home));
    // Public pages: the account link goes to the same admin home.
    await p.goto("/en");
    const links = p.locator(".site-header").getByRole("link", { name: t("chrome.myAdaig"), includeHidden: true });
    await expect(links.first(), label).toBeAttached();
    for (const l of await links.all()) await expect(l, label).toHaveAttribute("href", home);
    await p.context().close();
  }
});

/* ── buttons and forms per permission ──────────────────────────────────────────── */

for (const c of CASES.filter((x) => x.nav.length)) {
  test(`${c.label}: buttons and forms for actions the role lacks are absent`, async ({ loginAs }) => {
    const applicant = await createUser(); await createMembership(applicant.id, { status: "pending_verification" });
    const locked = await createMember(); await lock(locked.email);
    const member = await createMember();
    const draft = await createEvent({ published: false });
    const msgText = `E2E rbac buttons ${RUN} ${Math.random().toString(36).slice(2, 8)}`; await addMessage(msgText);
    const P = c.perms;
    const p = await loginAs(await createAdmin(P), { expectUrl: homeRe(c.home) });

    // Members list: New account (create), approve / reject / unlock (edit); the CSV (view) always.
    await p.goto(`/en/admin/members?f=pending&q=${enc(applicant.email)}`);
    await expect(p.locator("main tbody tr", { hasText: applicant.email })).toHaveCount(1);
    await expect(p.locator("main").getByRole("link", { name: tm("newAccount") })).toHaveCount(n(can(P, "members", "create")));
    await expect(p.locator(`main a[href^="/api/admin/members.csv"]`)).toHaveCount(1);
    await expect(p.getByRole("button", { name: `${ta("approve")}: ${applicant.name}` })).toHaveCount(n(can(P, "members", "edit")));
    await expect(p.locator(`summary[aria-label="${ta("reject")}: ${applicant.name}"]`)).toHaveCount(n(can(P, "members", "edit")));
    await p.goto(`/en/admin/members?q=${enc(locked.email)}`);
    const lockedRow = p.locator("main tbody tr", { hasText: locked.email });
    await expect(lockedRow.getByText(ta("locked"), { exact: true })).toBeVisible();
    await expect(lockedRow.locator("form button")).toHaveCount(n(can(P, "members", "edit")));

    // Member account page: profile save, temporary password, membership controls, CPE (edit); delete zone (delete).
    await p.goto(`/en/admin/members/${member.id}`);
    await expect(p.getByRole("button", { name: tm("saveProfile") })).toHaveCount(n(can(P, "members", "edit")));
    await expect(p.locator("#pw-new")).toHaveCount(n(can(P, "members", "edit")));
    await expect(p.locator("#memberships summary", { hasText: tm("changeTier") })).toHaveCount(n(can(P, "members", "edit")));
    await expect(p.locator("#c-title")).toHaveCount(n(can(P, "members", "edit")));
    await expect(p.locator("#delete")).toHaveCount(n(can(P, "members", "delete")));
    if (!can(P, "members", "edit") && !can(P, "members", "delete")) await expect(p.locator("main form"), "read-only account page").toHaveCount(0);

    // Events: "+ New event" (create), publish (edit); event page edit form (edit), delete (delete); the CSV (view) always.
    await p.goto("/en/admin/events");
    await expect(p.locator(`main a[href="/en/admin/events/${draft.id}"]`).first()).toBeVisible();
    await expect(p.locator("#new-event")).toHaveCount(n(can(P, "events", "create")));
    await expect(publishForm(p, draft.title)).toHaveCount(n(can(P, "events", "edit")));
    await p.goto(`/en/admin/events/${draft.id}`);
    await expect(p.locator("#e-ti")).toHaveCount(n(can(P, "events", "edit")));
    await expect(p.locator("#danger summary", { hasText: te("deleteBtn") })).toHaveCount(n(can(P, "events", "delete")));
    await expect(p.locator(`main a[href^="/api/admin/events/${draft.id}/registrations.csv"]`)).toHaveCount(1);

    // Messages: Mark handled (edit); the CSV (view) always.
    await p.goto("/en/admin/messages");
    const item = p.locator("li.inbox-item", { hasText: msgText });
    await expect(item).toBeVisible();
    await expect(item.locator("form")).toHaveCount(n(can(P, "messages", "edit")));
    await expect(p.locator(`main a[href^="/api/admin/messages.csv"]`)).toHaveCount(1);
  });
}

test("Overview & system with view only: Settings is read-only; tools and CSVs follow the permissions", async ({ loginAs }) => {
  const p = await loginAs(await createAdmin({ system: ["view"] }), { expectUrl: /\/en\/admin\/dashboard$/ });
  await expectSidebar(p, []);
  await p.goto("/en/admin/settings");
  await expect(p).toHaveURL(/\/en\/admin\/settings$/);
  await expect(p.locator("main")).toContainText(ta("readOnly"));
  // Read-only values as text (no inputs, no forms): the tier card is still there, its name field is not.
  await expect(p.locator("#tier-student")).toBeVisible();
  await expect(p.locator("#t-student-ne")).toHaveCount(0);
  await expect(p.locator("main form")).toHaveCount(0);
  await expect(p.locator("main form").getByRole("button")).toHaveCount(0);
  await p.goto("/en/admin/dashboard");
  await expect(p.locator(`main a[href="/api/admin/audit.csv"]`)).toBeVisible();
  for (const href of ["/api/admin/members.csv", "/api/admin/registrations.csv", "/api/admin/messages.csv", "/en/admin/members", "/en/admin/events", "/en/admin/messages"])
    await expect(p.locator(`main a[href="${href}"]`), href).toHaveCount(0);
});

/* ── forged server actions ─────────────────────────────────────────────────────── */

test("server actions refuse forged submissions from a Viewer: DB unchanged, each refusal audited (control: the Super Admin's replay works)", async ({ adminPage: p, loginAs }) => {
  test.setTimeout(120_000);
  const viewer = await createAdmin(ROLE_PRESETS.viewer);
  const vp = await loginAs(viewer, { expectUrl: /\/en\/admin\/members$/ });
  const applicant = await createUser(); await createMembership(applicant.id, { status: "pending_verification" });
  const victim = await createMember();
  const draft = await createEvent({ published: false });
  const doomed = await createEvent({ published: false });
  const msgText = `E2E rbac replay ${RUN} ${Math.random().toString(36).slice(2, 8)}`; const msgId = await addMessage(msgText);
  const tierBefore = await one<{ value: unknown }>(`SELECT value FROM "Setting" WHERE key = 'tier.student'`);
  const evTitle = uniqueName("Event"); const newEmail = uniqueEmail(); const pw = uniquePassword(); const roleName = uniqueName("Role");

  // Capture every form as the Super Admin (nothing is submitted here).
  await p.goto(`/en/admin/members?f=pending&q=${enc(applicant.email)}`);
  const approve = await formEntries(p.locator("form", { has: p.getByRole("button", { name: `${ta("approve")}: ${applicant.name}` }) }));
  await p.goto(`/en/admin/members/${victim.id}`);
  await p.locator("#p-job").fill("E2E Forged Job");
  const profile = await formEntries(p.locator("form#profile"));
  await p.locator("#delete input[name=confirm]").check();
  const delAccount = await formEntries(p.locator("#delete"));
  await p.goto("/en/admin/events");
  await p.locator("#new-event summary").click();
  const nf = p.locator("#new-event form");
  await nf.locator("#ti").fill(evTitle); await nf.locator("#su").fill("Forged by the E2E suite.");
  await nf.locator("#ty").selectOption("Webinar"); await nf.locator("#fo").selectOption("Online");
  await nf.locator("#st").fill("2027-03-10T10:00"); await nf.locator("#du").fill("60"); await nf.locator("#cp").fill("1");
  await nf.locator("#mp").fill("0"); await nf.locator("#pp").fill("10");
  const createEv = await formEntries(nf);
  const publish = await formEntries(publishForm(p, draft.title));
  await p.goto(`/en/admin/events/${doomed.id}`);
  const delEvent = await formEntries(p.locator("#danger form").filter({ hasText: te("deleteYes") }));
  await p.goto("/en/admin/messages");
  const handle = await formEntries(p.locator("li.inbox-item", { hasText: msgText }).locator("form"));
  await p.goto("/en/admin/settings");
  await p.locator("#t-student-ne").fill(`E2E Hacked ${RUN}`);
  const tier = await formEntries(p.locator("#tier-student"));
  await p.goto("/en/admin/users/new");
  await p.locator("#u-name").fill(uniqueName("Forged")); await p.locator("#u-email").fill(newEmail);
  await p.locator("#u-pw").fill(pw); await p.locator("#u-pw2").fill(pw); await p.locator("#u-role").selectOption(viewer.roleId);
  const createUserF = await formEntries(p.locator("main form", { has: p.locator("#u-email") }));
  await p.goto("/en/admin/roles/new");
  await p.locator("#r-name").fill(roleName); await p.locator("#perm-members-view").check();
  const createRoleF = await formEntries(p.locator("main form", { has: p.locator("#r-name") }));
  for (const e of [approve, profile, delAccount, createEv, publish, delEvent, handle, tier, createUserF, createRoleF])
    expect(e.some(([k]) => k.startsWith("$ACTION_"))).toBe(true);

  // Redirect-style actions: 303 → /en/admin/no-access.
  const redirectStyle: [string, string, Entries][] = [
    ["/en/admin/members", "approve application", approve],
    [`/en/admin/members/${victim.id}`, "save member profile", profile],
    [`/en/admin/members/${victim.id}`, "delete member account", delAccount],
    ["/en/admin/events", "create event", createEv],
    ["/en/admin/events", "publish event", publish],
    [`/en/admin/events/${doomed.id}`, "delete event", delEvent],
    ["/en/admin/messages", "mark message handled", handle],
    ["/en/admin/settings", "save membership tier", tier],
  ];
  for (const [path, what, e] of redirectStyle) {
    const r = await post(vp.request, path, e);
    expect(r.status(), what).toBe(303);
    expect(r.headers()["location"], what).toMatch(/\/en\/admin\/no-access$/);
  }
  // useActionState actions answer with their form state (no redirect to a success page).
  for (const [path, what, e] of [["/en/admin/users/new", "create user", createUserF], ["/en/admin/roles/new", "create role", createRoleF]] as const) {
    const r = await post(vp.request, path, e);
    expect(r.status(), what).toBeLessThan(400);
    expect(r.headers()["location"] ?? "", what).not.toMatch(/\/admin\/(users|roles)\/[^/?]+\?msg=msg_created/);
  }

  // Nothing changed.
  expect((await membershipsOf(applicant.id))[0].status).toBe("pending_verification");
  expect(await userById(victim.id)).toMatchObject({ role: "member", jobTitle: null });
  expect(await eventByTitle(evTitle)).toBeUndefined();
  expect((await eventById(draft.id))!.published).toBe(false);
  expect(await eventById(doomed.id)).toBeDefined();
  expect(await messageStatus(msgId)).toBe("new");
  expect(await one<{ value: unknown }>(`SELECT value FROM "Setting" WHERE key = 'tier.student'`)).toEqual(tierBefore);
  expect(await userByEmail(newEmail)).toBeUndefined();
  expect(await roleByName(roleName)).toBeUndefined();
  // One audit row per refusal, naming the missing permission.
  expect(await deniedTargets(viewer.id)).toEqual(
    ["members.edit", "members.edit", "members.delete", "events.create", "events.edit", "events.delete", "messages.edit", "system.edit", "users.create", "roles.create"].sort());

  // Control: the same replays by the Super Admin take effect (so the refusals above are permission checks).
  expect((await post(p.request, "/en/admin/events", publish)).status()).toBe(303);
  expect((await eventById(draft.id))!.published).toBe(true);
  expect((await post(p.request, "/en/admin/messages", handle)).status()).toBe(303);
  expect(await messageStatus(msgId)).toBe("handled");
  expect((await post(p.request, "/en/admin/roles/new", createRoleF)).status()).toBe(303);
  expect((await roleByName(roleName))!.permissions).toEqual({ members: ["view"] });
});

/**
 * In the signed-in page: take `form` (or a new form appended to <body> when null), drop its own $ACTION_ID_ field, add `fields` (another
 * action's id and inputs) and POST it to the current page path with fetch, following redirects. Returns the final URL.
 */
async function retargetAndPost(p: Page, form: Locator | null, fields: Entries) {
  const run = async (root: Element, fs: [string, string][]) => {
    const el = root instanceof HTMLFormElement ? root : root.appendChild(document.createElement("form"));
    for (const x of Array.from(el.querySelectorAll("input[name^='$ACTION_ID_']"))) x.remove();
    for (const [k, v] of fs) {
      for (const x of Array.from(el.querySelectorAll(`input[name="${k}"]`))) x.remove();
      const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; el.appendChild(i);
    }
    const r = await fetch(location.pathname, { method: "POST", body: new FormData(el) });
    return { status: r.status, url: r.url };
  };
  return (form ?? p.locator("body")).evaluate(run, fields);
}

test("forms re-targeted in the DOM to a forbidden action id are refused (edit-without-delete role; Event Manager; Member Manager)", async ({ adminPage, loginAs }) => {
  const victim = await createMember();
  const draft = await createEvent({ published: false });
  // The forbidden actions' ids and fields, as the Super Admin's pages render them.
  await adminPage.goto(`/en/admin/members/${victim.id}`);
  await adminPage.locator("#delete input[name=confirm]").check();
  const del = await formEntries(adminPage.locator("#delete"));
  await adminPage.goto("/en/admin/events");
  const pub = await formEntries(publishForm(adminPage, draft.title));
  for (const e of [del, pub]) expect(e.some(([k]) => k.startsWith("$ACTION_ID_"))).toBe(true);

  // (1) Members View + Edit, no Delete: the account page's own profile form, re-pointed at the delete action.
  const editor = await createAdmin({ members: ["view", "edit"] });
  const xp = await loginAs(editor, { expectUrl: /\/en\/admin\/members$/ });
  await xp.goto(`/en/admin/members/${victim.id}`);
  await expect(xp.locator("#delete")).toHaveCount(0);
  const r1 = await retargetAndPost(xp, xp.locator("form#profile"), del);
  expect(r1.url).toMatch(/\/en\/admin\/no-access$/);
  expect(await deniedTargets(editor.id)).toEqual(["members.delete"]);

  // (2) Event Manager (Members: View): a form injected into the read-only account page, carrying the delete action.
  const em = await createAdmin(ROLE_PRESETS.eventManager);
  const ep = await loginAs(em, { expectUrl: /\/en\/admin\/members$/ });
  await ep.goto(`/en/admin/members/${victim.id}`);
  await expect(ep.locator("main form")).toHaveCount(0);
  const r2 = await retargetAndPost(ep, null, del);
  expect(r2.url).toMatch(/\/en\/admin\/no-access$/);
  expect(await deniedTargets(em.id)).toEqual(["members.delete"]);

  // (3) Member Manager (Events: View): the publish action injected into the read-only events list.
  const mm = await createAdmin(ROLE_PRESETS.memberManager);
  const mp = await loginAs(mm, { expectUrl: /\/en\/admin\/members$/ });
  await mp.goto("/en/admin/events");
  await expect(publishForm(mp, draft.title)).toHaveCount(0);
  const r3 = await retargetAndPost(mp, null, pub);
  expect(r3.url).toMatch(/\/en\/admin\/no-access$/);
  expect(await deniedTargets(mm.id)).toEqual(["events.edit"]);

  expect(await userById(victim.id)).toMatchObject({ role: "member", deletedAt: null });
  expect((await eventById(draft.id))!.published).toBe(false);
  // Control: the same in-page post by the Super Admin publishes the event.
  await adminPage.goto("/en/admin/events");
  const r4 = await retargetAndPost(adminPage, null, pub);
  expect(r4.url).not.toMatch(/no-access/);
  expect((await eventById(draft.id))!.published).toBe(true);
});

/* ── API routes ────────────────────────────────────────────────────────────────── */

test("CSV exports answer 403 without the module's view permission (and 200 with it)", async ({ loginAs }) => {
  test.setTimeout(120_000);
  const ev = await createEvent();
  const API: [string, string][] = [
    ["/api/admin/members.csv", "members"],
    ["/api/admin/registrations.csv", "events"],
    [`/api/admin/events/${ev.id}/registrations.csv`, "events"],
    ["/api/admin/messages.csv", "messages"],
    ["/api/admin/audit.csv", "system"],
  ];
  const roles: [string, Perms][] = [
    ["Viewer", ROLE_PRESETS.viewer], ["Member Manager", ROLE_PRESETS.memberManager], ["Event Manager", ROLE_PRESETS.eventManager],
    ["events only", ROLE_PRESETS.eventsOnly], ["system view", { system: ["view"] }], ["no permissions", ROLE_PRESETS.none],
  ];
  for (const [label, perms] of roles) {
    const u = await createAdmin(perms);
    const p = await loginAs(u, { expectUrl: /\/en\/admin\/(members|events|dashboard|no-access)$/ });
    const denied: string[] = [];
    for (const [url, m] of API) {
      const r = await p.request.get(url);
      if (can(perms, m, "view")) {
        expect(r.status(), `${label} ${url}`).toBe(200);
        expect(r.headers()["content-type"], `${label} ${url}`).toContain("text/csv");
      } else {
        expect(r.status(), `${label} ${url}`).toBe(403);
        expect(r.headers()["cache-control"], `${label} ${url}`).toContain("no-store");
        expect(await r.text(), `${label} ${url}`).not.toContain(",");
        denied.push(`${m}.view`);
      }
    }
    expect(await deniedTargets(u.id), label).toEqual(denied.sort());
    await p.context().close();
  }
});

/* ── deactivated accounts ──────────────────────────────────────────────────────── */

test("a deactivated admin is blocked everywhere: pages, Profile, APIs, server actions, session, sign-in", async ({ adminPage, loginAs, newPage }) => {
  const u = await createAdmin(ROLE_PRESETS.eventManager);
  const s = await loginAs(u, { expectUrl: /\/en\/admin\/members$/ });
  const draft = await createEvent({ published: false });
  await adminPage.goto("/en/admin/events");
  const publish = await formEntries(publishForm(adminPage, draft.title));
  expect((await s.request.get("/api/admin/members.csv")).status()).toBe(200);
  await s.goto("/en/admin/events");
  await expect(publishForm(s, draft.title)).toHaveCount(1);

  await setActive(u.id, false); // DB only: no sessionVersion bump, so the app's `active` checks alone must end the session

  for (const path of ["/en/admin", "/en/admin/members", "/en/admin/events", "/en/admin/no-access", "/en/my/profile", "/en/my/billing"]) {
    await s.goto(path);
    await expect(s, path).toHaveURL(/\/en\/login/);
    await expect(s.locator("header.admin-header"), path).toHaveCount(0);
  }
  for (const url of ["/api/admin/members.csv", "/api/admin/registrations.csv", "/api/admin/messages.csv"])
    expect((await s.request.get(url)).status(), url).toBe(403);
  expect((await s.request.get("/api/me/export")).status()).toBe(401);
  const session = await (await s.request.get("/api/auth/session")).json().catch(() => null) as { user?: unknown } | null;
  expect(session?.user).toBeUndefined();
  const r = await post(s.request, "/en/admin/events", publish);
  expect(r.status()).toBe(303);
  expect(r.headers()["location"]).toMatch(/\/en\/login/);
  expect((await eventById(draft.id))!.published).toBe(false);
  await s.goto("/en");
  await expect(s.locator(".site-header").getByRole("link", { name: t("chrome.myAdaig"), includeHidden: true })).toHaveCount(0);

  // Signing in again with the right password: the same generic error as a wrong password (no account-state leak).
  const f = await newPage();
  await f.goto("/en/login");
  await f.locator("#le").fill(u.email); await f.locator("#lp").fill(u.password);
  await f.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(f, t("auth.invalid"), { email: u.email });
  expect((await auditRows({ action: "auth.login_blocked_inactive", target: u.email })).length).toBeGreaterThanOrEqual(1);
  expect((await userById(u.id))!.active).toBe(false);
});

test("a deactivated member account is blocked too (sign-in and existing session)", async ({ loginAs, newPage }) => {
  const m = await createMember();
  const s = await loginAs(m, { expectUrl: /\/en\/my\/billing$/ });
  await setActive(m.id, false);
  await s.goto("/en/my/billing");
  await expect(s).toHaveURL(/\/en\/login/);
  const f = await newPage();
  await f.goto("/en/login");
  await f.locator("#le").fill(m.email); await f.locator("#lp").fill(m.password);
  await f.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(f, t("auth.invalid"), { email: m.email });
});

/* ── Members vs Admin Portal accounts ──────────────────────────────────────────── */

test("Members never shows admin accounts, and Members actions refuse admin targets (Member Manager vs a Super Admin)", async ({ loginAs }) => {
  const mm = await createAdmin(ROLE_PRESETS.memberManager);
  const p = await loginAs(mm, { expectUrl: /\/en\/admin\/members$/ });
  const sa = await createUser({ role: "admin" }); // an e2e Super Admin, also holding a pending application
  const saMembership = await createMembership(sa.id, { status: "pending_verification" });
  const victim = await createMember();
  const applicant = await createUser(); await createMembership(applicant.id, { status: "pending_verification" });
  const saBefore = (await userById(sa.id))!;

  // List, pending queue and CSV: no admin accounts.
  for (const url of [`/en/admin/members?q=${enc(sa.email)}`, `/en/admin/members?f=pending&q=${enc(sa.email)}`, `/en/admin/members?q=${enc(SEED.admin)}`]) {
    await p.goto(url);
    await expect(p.locator("main tbody tr"), url).toHaveCount(0);
  }
  await p.goto(`/en/admin/members?q=${enc(victim.email)}`);
  await expect(p.locator("main tbody tr", { hasText: victim.email })).toHaveCount(1);
  const csv = await (await p.request.get("/api/admin/members.csv")).text();
  expect(csv).toContain(victim.email);
  expect(csv).not.toContain(sa.email);
  expect(csv).not.toContain(SEED.admin);
  // The account page of an admin is the admin 404.
  const r404 = await p.goto(`/en/admin/members/${sa.id}`);
  expect(r404?.status()).toBe(404);
  await expect(p.locator("main#main h1")).toHaveText(t("errors.notFoundTitle"));
  await expect(p.locator("header.admin-header")).toBeVisible();

  // Temporary password (members action) re-pointed at the Super Admin: in the DOM, then posted directly.
  await p.goto(`/en/admin/members/${victim.id}`);
  const pwForm = p.getByRole("form", { name: tm("pwTitle") });
  await p.locator("#pw-new").fill(uniquePassword());
  await setValue(pwForm.locator("input[name=uid]"), sa.id); // last, so no re-render can restore the controlled value
  await pwForm.getByRole("button", { name: tm("pwButton") }).click();
  await expect(pwForm.getByRole("alert")).toHaveText(tm("err_notFound"));
  await expect(pwForm.locator("code")).toHaveCount(0);
  await p.goto(`/en/admin/members/${victim.id}`);
  const pwEntries = withEntry(withEntry(await formEntries(pwForm), "uid", sa.id), "password", uniquePassword());
  expect((await post(p.request, `/en/admin/members/${victim.id}`, pwEntries)).status()).toBeLessThan(400);

  // Profile save and account deletion re-pointed at the Super Admin.
  const profile = withEntry(withEntry(await formEntries(p.locator("form#profile")), "uid", sa.id), "name", "E2E Hijacked Admin");
  const rp = await post(p.request, `/en/admin/members/${victim.id}`, profile);
  expect(rp.status()).toBe(303);
  expect(rp.headers()["location"]).toMatch(/\/en\/admin\/members\?msg=notFound/);
  await p.locator("#delete input[name=confirm]").check();
  const del = withEntry(await formEntries(p.locator("#delete")), "uid", sa.id);
  const rd = await post(p.request, `/en/admin/members/${victim.id}`, del);
  expect(rd.status()).toBe(303);
  expect(rd.headers()["location"]).toMatch(/msg=notFound/);
  // Approving the admin's application through another applicant's approve form.
  await p.goto(`/en/admin/members?f=pending&q=${enc(applicant.email)}`);
  const approve = withEntry(await formEntries(p.locator("form", { has: p.getByRole("button", { name: `${ta("approve")}: ${applicant.name}` }) })), "id", saMembership);
  const ra = await post(p.request, "/en/admin/members", approve);
  expect(ra.status()).toBe(303);
  expect(ra.headers()["location"]).toMatch(/msg=notFound/);
  // Unlock (members action) on a locked admin.
  await lock(sa.email);
  const locked = await createMember(); await lock(locked.email);
  await p.goto(`/en/admin/members?q=${enc(locked.email)}`);
  const unlock = withEntry(await formEntries(p.locator("main tbody tr", { hasText: locked.email }).locator("form").first()), "id", sa.id);
  await post(p.request, "/en/admin/members", unlock);
  expect(await one(`SELECT key FROM "LoginThrottle" WHERE key = $1`, [`e:${sa.email}`])).toBeDefined();

  const saAfter = (await userById(sa.id))!;
  expect(saAfter).toMatchObject({ role: "admin", active: true, name: saBefore.name, email: saBefore.email, passwordHash: saBefore.passwordHash, sessionVersion: saBefore.sessionVersion, adminRoleId: SUPER_ADMIN_ROLE_ID, deletedAt: null });
  expect((await membershipsOf(sa.id))[0].status).toBe("pending_verification");
  expect(await userById(victim.id)).toMatchObject({ role: "member", name: victim.name });
});

test("admins can't apply for membership on /join (Q4): notice instead of the form, and a forged application is refused", async ({ loginAs }) => {
  const admin = await createUser({ role: "admin" });
  const ap = await loginAs(admin, { expectUrl: /\/en\/admin\/members$/ });
  await ap.goto("/en/join");
  await expect(ap.locator("main").getByRole("status").filter({ hasText: t("join.err_adminAccount") })).toBeVisible();
  await expect(ap.locator("main form, #tier")).toHaveCount(0);

  // A signed-in guest's application form, posted with the admin's session.
  const g = await createUser();
  const gp = await loginAs(g, { expectUrl: /\/en\/my\/billing$/ });
  await gp.goto("/en/join?tier=professional");
  await gp.locator("#pr").selectOption("NY");
  const form = gp.locator("form", { has: gp.locator("#tier") });
  const e = await formEntries(form);
  expect(e.some(([k]) => k.startsWith("$ACTION_"))).toBe(true);
  const r = await post(ap.request, "/en/join", e);
  expect(r.status()).toBeLessThan(500);
  expect(r.headers()["location"] ?? "").not.toMatch(/applied=1/);
  expect(await membershipsOf(admin.id)).toHaveLength(0);
  expect(await membershipsOf(g.id)).toHaveLength(0);
  expect((await userById(admin.id))!.role).toBe("admin");
});

/* ── member portal ─────────────────────────────────────────────────────────────── */

test("the member portal is unaffected for a member: pages, menu, data export; admin pages and APIs stay closed", async ({ loginAs }) => {
  const m = await createMember();
  const p = await loginAs(m, { expectUrl: /\/en\/my\/billing$/ });
  await expect(p.locator("main#main h1")).toHaveText(t("member.billingPage.title"));
  await expect(p.locator("header.admin-header")).toHaveCount(0);
  const nav = p.getByRole("navigation", { name: t("member.navAria") });
  await expect(nav.locator("a")).toHaveText(["member.billing", "member.profile", "member.events", "member.community", "member.directory"].map((k) => re(t(k))));
  const hrefs = await nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  for (const href of hrefs) {
    const r = await p.goto(href);
    expect(r?.status(), href).toBe(200);
    await expect(p, href).toHaveURL(new RegExp(`${href}$`));
    await expect(p.locator("header.admin-header"), href).toHaveCount(0);
    await expect(p.getByRole("navigation", { name: t("member.navAria") }), href).toBeVisible();
  }
  for (const path of ["/en/admin", "/en/admin/members", "/en/admin/users", "/en/admin/users/new", "/en/admin/roles", "/en/admin/roles/new", "/en/admin/no-access"]) {
    await p.goto(path);
    await expect(p, path).toHaveURL(/\/en\/my\/billing$/);
  }
  for (const url of ["/api/admin/members.csv", "/api/admin/messages.csv", "/api/admin/audit.csv"])
    expect((await p.request.get(url)).status(), url).toBe(403);
  expect((await p.request.get("/api/me/export")).status()).toBe(200);
  const session = await (await p.request.get("/api/auth/session")).json() as { user?: { role?: string; permissions?: unknown } };
  expect(session.user?.role).toBe("member");
  expect(session.user?.permissions ?? null).toBeNull();
  // Already a member: /join goes to My membership as before.
  await p.goto("/en/join");
  await expect(p).toHaveURL(/\/en\/my\/billing\?already=1/);
  expect((await userById(m.id))!.adminRoleId).toBeNull();
});
