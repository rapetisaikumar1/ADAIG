/**
 * Authorization and injection checks beyond the UI: admin Server Actions replayed by members, guests and visitors
 * (and cross-origin) change nothing; roles are re-read on every request; user-supplied text is rendered inertly;
 * search input is treated literally.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, uiLogin } from "../fixtures";
import { createEvent, createMember, createUser, eventById, one, q, userById, RUN } from "../support/db";
import { t } from "../support/i18n";

/** The fields a form would post without JavaScript (Next.js progressive enhancement: $ACTION_ID_… + inputs). */
const formFields = (form: Locator) =>
  form.evaluate((f: HTMLFormElement) => Object.fromEntries(Array.from(new FormData(f).entries()).map(([k, v]) => [k, String(v)])));
const replay = (ctx: APIRequestContext, path: string, multipart: Record<string, string>, headers: Record<string, string> = {}) =>
  ctx.post(path, { multipart, maxRedirects: 0, headers });

test.describe("admin Server Actions refuse non-admins", () => {
  test("make admin: a member, a guest and a visitor replaying the form stay non-admin", async ({ adminPage, memberPage, guestPage, request }) => {
    const target = await createUser();
    await adminPage.goto(`/en/admin/members?q=${encodeURIComponent(target.email)}`);
    const fields = await formFields(adminPage.locator("form", { has: adminPage.getByRole("button", { name: `${t("admin.makeAdmin")}: ${target.name}` }) }));
    expect(Object.keys(fields).some((k) => k.startsWith("$ACTION_ID_"))).toBe(true);
    for (const [who, ctx] of [["member", memberPage.request], ["guest", guestPage.request], ["visitor", request]] as const) {
      const r = await replay(ctx, "/en/admin/members", fields);
      expect(r.status(), who).toBe(303);
      expect(r.headers()["location"], who).toMatch(/\/en\/login/);
      expect((await userById(target.id))!.role, who).toBe("guest");
    }
    // Control: the same replay by an admin works, so the refusals above are real authorization checks.
    expect((await replay(adminPage.request, "/en/admin/members", fields)).status()).toBe(303);
    expect((await userById(target.id))!.role).toBe("admin");
  });

  test("publish event, delete account, handle message, change settings: no effect for a member", async ({ adminPage, memberPage }) => {
    const e = await createEvent({ published: false });
    const victim = await createMember();
    const msgId = `e2e-${RUN}-${Math.random().toString(36).slice(2)}`;
    await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', 'E2E replay target', 'en')`, [msgId, `e2e+${RUN}-replay@example.test`]);

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
  await uiLogin(p, u);
  expect((await p.goto("/en/admin/dashboard"))?.status()).toBe(200);
  await expect(p.locator(".header-cta").getByRole("link", { name: t("chrome.admin") })).toBeVisible();
  await q(`UPDATE "User" SET role = 'guest' WHERE id = $1`, [u.id]);
  await p.goto("/en/admin/dashboard");
  await expect(p).toHaveURL(/\/en\/my\/dashboard/);
  expect((await p.request.get("/api/admin/members.csv")).status()).toBe(403);
});

test("user-supplied text is rendered as text (contact message, names, event titles)", async ({ page, adminPage }) => {
  const payload = `<img src=x onerror="window.__e2eXss=1"><script>window.__e2eXss=2</script> E2E ${RUN}`;
  await page.goto("/en/contact");
  await page.locator("#cf-name").fill(`E2E <b>bold</b> ${RUN}`);
  await page.locator("#cf-email").fill(`e2e+${RUN}-xss@example.test`);
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
  for (const qs of ["target=%25", "target=_", "actor=%25", "actor=_"]) {
    await adminPage.goto(`/en/admin/audit?${qs}`);
    await expect(adminPage.locator(".adm-table-audit tbody tr").first(), `audit ${decodeURIComponent(qs)}`).toContainText(t("audit.noResults"));
  }
});
