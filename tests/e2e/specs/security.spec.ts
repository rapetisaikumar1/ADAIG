/**
 * Authorization and injection checks beyond the UI: admin Server Actions replayed by members, guests, visitors and an admin
 * without the permission (and cross-origin) change nothing; roles and account status are re-read on every request;
 * user-supplied text is rendered inertly; search input is treated literally.
 * (The full permission matrix — every module's actions replayed per role — is in rbac.spec.ts.)
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, uiLogin } from "../fixtures";
import { auditRows, createAdmin, createEvent, createMember, createUser, eventById, one, q, userByEmail, userById, uniqueEmail, uniqueName, uniquePassword, RUN } from "../support/db";
import { t } from "../support/i18n";

/** The fields a form would post without JavaScript (Next.js progressive enhancement: $ACTION_ID_… + inputs). */
const formFields = (form: Locator) =>
  form.evaluate((f: HTMLFormElement) => Object.fromEntries(Array.from(new FormData(f).entries()).map(([k, v]) => [k, String(v)])));
const replay = (ctx: APIRequestContext, path: string, multipart: Record<string, string>, headers: Record<string, string> = {}) =>
  ctx.post(path, { multipart, maxRedirects: 0, headers });

test.describe("admin Server Actions refuse non-admins", () => {
  // Round 7: "make admin" (Members list) was removed; admin accounts are created only in Admin → Users.
  test("create admin user: replays by a member, a guest, a visitor and an admin without users.create create nothing", async ({ adminPage, memberPage, guestPage, request, loginAs }) => {
    // A Viewer-like admin (members/events/messages view only): signed in, but not allowed to create users.
    const viewer = await createAdmin({ members: ["view"], events: ["view"], messages: ["view"] });
    const viewerPage = await loginAs(viewer);
    const email = uniqueEmail(); const password = uniquePassword();
    await adminPage.goto("/en/admin/users/new");
    await adminPage.locator("#u-name").fill(uniqueName("Replay"));
    await adminPage.locator("#u-email").fill(email);
    await adminPage.locator("#u-pw").fill(password);
    await adminPage.locator("#u-pw2").fill(password);
    await adminPage.locator("#u-role").selectOption(viewer.roleId);
    const fields = await formFields(adminPage.locator("main form", { has: adminPage.locator("#u-email") }));
    expect(Object.keys(fields).some((k) => k.startsWith("$ACTION_"))).toBe(true);
    // The action refuses, then the page itself sends non-admins away (sign-in, or My membership for members and guests).
    for (const [who, ctx, to] of [["member", memberPage.request, /\/en\/(login|my\/billing)/], ["guest", guestPage.request, /\/en\/(login|my\/billing)/], ["visitor", request, /\/en\/login/]] as const) {
      const r = await replay(ctx, "/en/admin/users/new", fields);
      expect([303, 307], who).toContain(r.status());
      expect(r.headers()["location"], who).toMatch(to);
      expect(await userByEmail(email), who).toBeUndefined();
    }
    // An admin whose role lacks users.create: refused, audited, sent to the no-access page.
    const r = await replay(viewerPage.request, "/en/admin/users/new", fields);
    expect([303, 307], "viewer").toContain(r.status());
    expect(r.headers()["location"], "viewer").toMatch(/\/en\/admin\/no-access/);
    expect(await userByEmail(email), "viewer").toBeUndefined();
    expect(await auditRows({ action: "admin.permission_denied", actor: viewer.id, target: "users.create" })).toHaveLength(1);
    // Control: the same replay by the Super Admin creates the account, so the refusals above are real authorization checks.
    const ok = await replay(adminPage.request, "/en/admin/users/new", fields);
    expect(ok.status()).toBe(303);
    expect(ok.headers()["location"]).toMatch(/\/en\/admin\/users\/[^/?]+\?msg=msg_created/);
    expect(await userByEmail(email)).toMatchObject({ role: "admin", adminRoleId: viewer.roleId, active: true });
  });

  test("publish event, delete account, handle message, change settings: no effect for a member", async ({ adminPage, memberPage }) => {
    const e = await createEvent({ published: false });
    const victim = await createMember();
    const msgId = `e2e-${RUN}-${Math.random().toString(36).slice(2)}`;
    await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', 'E2E replay target', 'en')`, [msgId, `e2e-${RUN}-replay@example.test`]);

    await adminPage.goto("/en/admin/events");
    const publish = await formFields(adminPage.locator("form", { has: adminPage.getByRole("button", { name: `${t("admin.publish")}: ${e.title}`, exact: true }) }));
    await adminPage.goto(`/en/admin/members/${victim.id}`);
    await adminPage.locator("#delete input[name=confirm]").check();
    const del = await formFields(adminPage.locator("#delete"));
    await adminPage.goto("/en/admin/messages");
    const handle = await formFields(adminPage.locator("li.inbox-item", { hasText: "E2E replay target" }).locator("form"));
    await adminPage.goto("/en/admin/settings");
    await adminPage.locator("#t-student-ne").fill(`Hacked ${RUN}`);
    const tier = await formFields(adminPage.locator("#tier-student"));

    for (const [path, fields] of [["/en/admin/events", publish], [`/en/admin/members/${victim.id}`, del], ["/en/admin/messages", handle], ["/en/admin/settings", tier]] as const) {
      const r = await replay(memberPage.request, path, fields);
      expect(r.status(), path).toBe(303);
      expect(r.headers()["location"], path).toMatch(/\/en\/login/);
    }
    expect((await eventById(e.id))!.published).toBe(false);
    expect((await userById(victim.id))!.role).toBe("member");
    expect((await one<{ status: string }>(`SELECT status FROM "ContactMessage" WHERE id = $1`, [msgId]))!.status).toBe("new");
    expect(await one(`SELECT key FROM "Setting" WHERE key = 'tier.student'`)).toBeUndefined();
  });

  test("a cross-origin replay by a signed-in admin is rejected (CSRF)", async ({ adminPage }) => {
    const e = await createEvent({ published: false });
    await adminPage.goto("/en/admin/events");
    const fields = await formFields(adminPage.locator("form", { has: adminPage.getByRole("button", { name: `${t("admin.publish")}: ${e.title}`, exact: true }) }));
    const r = await replay(adminPage.request, "/en/admin/events", fields, { origin: "https://evil.example" });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect((await eventById(e.id))!.published).toBe(false);
  });
});

test("roles are re-read on every request: a demoted admin loses access immediately", async ({ newPage }) => {
  const u = await createUser({ role: "admin" });
  const p: Page = await newPage();
  await uiLogin(p, u, { expectUrl: /\/en\/admin\/members$/ });
  expect((await p.goto("/en/admin/dashboard"))?.status()).toBe(200);
  await expect(p.locator("header.admin-header")).toBeVisible();
  await p.goto("/en");
  await expect(p.locator(".header-cta").getByRole("link", { name: t("chrome.myAdaig") })).toHaveAttribute("href", "/en/admin/members");
  await q(`UPDATE "User" SET role = 'guest' WHERE id = $1`, [u.id]);
  await p.goto("/en/admin/dashboard");
  await expect(p).toHaveURL(/\/en\/my\/billing$/);
  await expect(p.locator("header.admin-header")).toHaveCount(0);
  await p.goto("/en");
  await expect(p.locator(".header-cta").getByRole("link", { name: t("chrome.myAdaig") })).toHaveAttribute("href", "/en/my/billing");
  expect((await p.request.get("/api/admin/members.csv")).status()).toBe(403);
});

test("account status is re-read on every request: a deactivated account is signed out immediately", async ({ newPage }) => {
  const admin = await createUser({ role: "admin" }); const member = await createMember();
  const ap: Page = await newPage(); await uiLogin(ap, admin, { expectUrl: /\/en\/admin\/members$/ });
  const mp: Page = await newPage(); await uiLogin(mp, member, { expectUrl: /\/en\/my\/billing$/ });
  await q(`UPDATE "User" SET active = false WHERE id = ANY($1)`, [[admin.id, member.id]]);
  await ap.goto("/en/admin/members");
  await expect(ap).toHaveURL(/\/en\/login/);
  await expect(ap.locator("header.admin-header")).toHaveCount(0);
  expect((await ap.request.get("/api/admin/members.csv")).status()).toBe(403);
  await mp.goto("/en/my/billing");
  await expect(mp).toHaveURL(/\/en\/login/);
  // The public header treats them as signed out.
  await mp.goto("/en");
  await expect(mp.locator(".header-cta").getByRole("link", { name: t("chrome.myAdaig") })).toHaveCount(0);
});

test("user-supplied text is rendered as text (contact message, names, event titles)", async ({ page, adminPage }) => {
  const payload = `<img src=x onerror="window.__e2eXss=1"><script>window.__e2eXss=2</script> E2E ${RUN}`;
  await page.goto("/en/contact");
  await page.locator("#cf-name").fill(`E2E <b>bold</b> ${RUN}`);
  await page.locator("#cf-email").fill(`e2e-${RUN}-xss@example.test`);
  await page.locator("#cf-topic").selectOption("other");
  await page.locator("#cf-msg").fill(payload);
  await page.locator(".contact-form input[name=consent]").check();
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator(".contact-sent")).toBeVisible();

  await adminPage.goto("/en/admin/messages");
  const item = adminPage.locator("li.inbox-item", { hasText: `E2E ${RUN}` }).filter({ hasText: "onerror" });
  await expect(item.locator(".inbox-body")).toHaveText(payload);
  await expect(item.locator("img, script, b")).toHaveCount(0);
  expect(await adminPage.evaluate(() => (window as unknown as { __e2eXss?: number }).__e2eXss)).toBeUndefined();

  const e = await createEvent({ title: `E2E <img src=x onerror="window.__e2eXss=3"> ${RUN}` });
  await page.goto(`/en/events/${e.slug}`);
  await expect(page.locator("h1")).toHaveText(e.title);
  await expect(page.locator("h1 img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __e2eXss?: number }).__e2eXss)).toBeUndefined();
});

test("search treats % and _ literally (events, directory, event registrations, audit log)", async ({ page, loginAs, adminPage }) => {
  // Public events: wildcard-shaped queries only match literally (independent of other events in the database).
  const tok = `Lit${RUN}${Math.random().toString(36).slice(2, 6)}`;
  const plain = await createEvent({ title: `E2E ${tok}ab clinic` });
  const literal = await createEvent({ title: `E2E ${tok} 50%_off day` });
  const search = async (q: string) => { await page.goto(`/en/events?q=${encodeURIComponent(q)}`); return page.locator(".event-card h3 a"); };
  await expect(await search(`${tok}%clinic`), "% is not a wildcard").toHaveCount(0);
  await expect(await search(`${tok}a_ clinic`), "_ is not a wildcard").toHaveCount(0);
  await expect(await search(`${tok.toUpperCase()}AB CLINIC`)).toHaveText([plain.title]); // case-insensitive still
  await expect(await search(`${tok} 50%_OFF`)).toHaveText([literal.title]); // literal % and _ are found

  // Member directory: a listed member exists, but "%" / "_" match nobody.
  const listed = await createMember({ directoryOptIn: true });
  const p = await loginAs(listed);
  for (const qs of ["%25", "_"]) {
    await p.goto(`/en/my/directory?q=${qs}`);
    await expect(p.locator(".mbr-people .member-card"), `directory q=${decodeURIComponent(qs)}`).toHaveCount(0);
  }
  await p.goto(`/en/my/directory?q=${encodeURIComponent(listed.name.toUpperCase())}`);
  await expect(p.locator(".mbr-people .member-card")).toHaveCount(1);

  // Admin: event registrations search and audit target filter.
  const e = await createEvent();
  const { createRegistration } = await import("../support/db");
  await createRegistration(listed.id, e.id);
  for (const qs of ["%25", "_"]) {
    await adminPage.goto(`/en/admin/events/${e.id}?q=${qs}`);
    await expect(adminPage.locator(".adm-table-regs tbody tr"), `registrations q=${decodeURIComponent(qs)}`).toHaveCount(0);
  }
  await adminPage.goto(`/en/admin/events/${e.id}?q=${encodeURIComponent(listed.email.toUpperCase())}`);
  await expect(adminPage.locator(".adm-table-regs tbody tr")).toHaveCount(1);
  // Audit target filter ("contains"): scoped to this test's own rows, because real targets may contain a literal "_" or "%"
  // (e.g. "<user id> (role: sys_super_admin)" since round 7). Each query would match the first row if % / _ were wildcards.
  const aTok = `e2e-${tok.toLowerCase()}`;
  await q(`INSERT INTO "AuditLog" (id, actor, action, target) VALUES ($1, 'system', 'e2e.literal', $2), ($3, 'system', 'e2e.literal', $4)`,
    [`e2e-${tok}-a1`, `${aTok}ab-x`, `e2e-${tok}-a2`, `${aTok} 50%_off`]);
  for (const target of [`${aTok}%x`, `${aTok}a_-x`]) {
    await adminPage.goto(`/en/admin/audit?target=${encodeURIComponent(target)}`);
    await expect(adminPage.getByRole("heading", { name: t("audit.noResults") }), `audit target=${target}`).toBeVisible();
  }
  await adminPage.goto(`/en/admin/audit?target=${encodeURIComponent(`${aTok.toUpperCase()} 50%_OFF`)}`); // literal % and _ are found
  await expect(adminPage.locator("main table tbody tr")).toHaveCount(1);
  await expect(adminPage.locator("main table tbody tr")).toContainText("50%_off");
  // Actor filter (exact match): "%" and "_" alone match nobody.
  for (const qs of ["actor=%25", "actor=_"]) {
    await adminPage.goto(`/en/admin/audit?${qs}`);
    await expect(adminPage.getByRole("heading", { name: t("audit.noResults") }), `audit ${decodeURIComponent(qs)}`).toBeVisible();
  }
});
