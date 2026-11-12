/**
 * Admin operations and platform security: admin pages render (EN/FR), the removed Content admin is a 404, audit log filters + CSV,
 * System page shows no secret values, CSV exports are admin-only, cron endpoint auth and rate-limit bucket pruning, Supabase RLS (anon/authenticated cannot read
 * tables).
 */
import pg from "pg";
import { test, expect, watchConsole, expectNoHorizontalOverflow } from "../fixtures";
import { createUser, etDay, q, userByEmail, RUN } from "../support/db";
import { appDotEnv, databaseUrl, SEED } from "../support/env";
import { TABLES } from "../support/snapshot";
import { t } from "../support/i18n";

test("every admin page renders in EN and FR without errors or overflow at 390px @smoke", async ({ adminPage: p }) => {
  const errors = watchConsole(p);
  await p.setViewportSize({ width: 390, height: 844 });
  // Round 7: Users and Roles added; the Content admin (content, content/about/fr) was removed (see "the Content admin is gone").
  const pages = ["dashboard", "members", "members/new", "events", "messages", "users", "users/new", "roles", "roles/new", "settings", "audit", "system", "corporate", "chapter"];
  // Detail pages: a seed admin's Users page and the Super Admin role.
  const admin2 = (await userByEmail(SEED.admin2))!;
  const details = [`users/${admin2.id}`, "roles/sys_super_admin"];
  for (const locale of ["en", "fr"]) for (const path of [...pages, ...details]) {
    const r = await p.goto(`/${locale}/admin/${path}`);
    expect(r?.status(), `${locale}/admin/${path}`).toBe(200);
    await expect(p.locator("main#main h1").first(), `${locale}/admin/${path}`).toBeVisible();
    // Admin portal chrome only: the minimal admin header and footer, never the public header/footer.
    await expect(p.locator("header.admin-header"), `${locale}/admin/${path}`).toBeVisible();
    await expect(p.locator(".site-header, .site-footer, #primary-nav"), `${locale}/admin/${path}`).toHaveCount(0);
    await expectNoHorizontalOverflow(p, `${locale}/admin/${path}`);
  }
  await p.goto("/en/admin/dashboard");
  for (const href of ["/api/admin/members.csv", "/api/admin/registrations.csv", "/api/admin/messages.csv", "/api/admin/audit.csv"])
    await expect(p.locator(`main#main a[href="${href}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Content admin is gone: its URLs are the admin 404, the public pages still render", async ({ adminPage: p, page }) => {
  for (const path of ["/en/admin/content", "/en/admin/content/home/en"]) {
    const r = await p.goto(path);
    expect(r?.status(), path).toBe(404);
    await expect(p.locator("main#main h1"), path).toHaveText(t("errors.notFoundTitle"));
    await expect(p.locator("header.admin-header"), path).toBeVisible(); // the admin 404, inside the admin portal chrome
    await expect(p.locator(".site-header"), path).toHaveCount(0);
  }
  // No way back in: the dashboard's tools and the sidebar have no Content link.
  await p.goto("/en/admin/dashboard");
  await expect(p.locator('a[href^="/en/admin/content"]')).toHaveCount(0);
  // The stored page texts (ContentPage) still drive the public site.
  const r = await page.goto("/en/about");
  expect(r?.status()).toBe(200);
  await expect(page.locator("main#main")).toBeVisible();
  await expect(page.locator(".site-header")).toBeVisible();
});

test("audit log: filters by action, actor, target and date; CSV uses the same filters", async ({ adminPage: p }) => {
  const u = await createUser();
  // Two admin actions on the account → two audit entries targeting it.
  await p.goto(`/en/admin/members/${u.id}`);
  await p.locator("#p-job").fill(`E2E Auditor ${RUN}`);
  await p.getByRole("button", { name: t("adminMembers.saveProfile") }).click();
  await expect(p).toHaveURL(/msg=msg_profileSaved/);
  await p.goto(`/en/admin/members/${u.id}`);
  await p.locator("#c-title").fill(`E2E audit CPE ${RUN}`);
  await p.getByRole("button", { name: t("adminMembers.cpeAdd") }).click();
  await expect(p).toHaveURL(/msg=msg_cpeAdded/);

  await p.goto("/en/admin/audit");
  await p.locator("#au-a").selectOption("cpe.entry_added");
  await p.locator("#au-target").fill(u.id);
  await p.getByRole("button", { name: t("audit.apply") }).click();
  await expect(p).toHaveURL(new RegExp(`a=cpe.entry_added.*target=${u.id}`));
  const rows = p.locator(".adm-table-audit tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("cpe.entry_added");
  await expect(rows.first()).toContainText(u.name); // target resolved to the person
  await expect(p.locator(".adm-count")).toHaveText(t("audit.showingOne")); // a single result reads "Showing 1 entry"

  // Target only → both entries; actor (by email) + action → just the profile update.
  await p.goto(`/en/admin/audit?target=${u.id}`);
  await expect(rows).toHaveCount(2);
  await p.goto(`/en/admin/audit?actor=${encodeURIComponent(SEED.admin)}&a=admin.profile_updated&target=${u.id}`);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("admin.profile_updated");
  // Searching by the person's email also finds them.
  await p.goto(`/en/admin/audit?target=${encodeURIComponent(u.email)}`);
  await expect(rows).toHaveCount(2);
  // A date range after today (ET) → no results.
  const tomorrow = etDay(new Date(Date.now() + 864e5));
  await p.goto(`/en/admin/audit?target=${u.id}&from=${tomorrow}`);
  await expect(p.getByRole("heading", { name: t("audit.noResults") })).toBeVisible();
  await p.goto(`/en/admin/audit?target=${u.id}&from=${etDay(new Date())}&to=${etDay(new Date())}`);
  await expect(rows).toHaveCount(2);

  // CSV export link carries the filters.
  await p.goto(`/en/admin/audit?a=cpe.entry_added&target=${u.id}`);
  const href = await p.getByRole("link", { name: t("audit.exportCsv") }).getAttribute("href");
  expect(href).toBe(`/api/admin/audit.csv?a=cpe.entry_added&target=${u.id}`);
  const csv = await p.request.get(href!);
  expect(csv.status()).toBe(200);
  const lines = (await csv.text()).split("\n");
  expect(lines[0]).toBe('"createdAt","action","actor","actorEmail","target","createdET"');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(`"cpe.entry_added"`);
  expect(lines[1]).toContain(`"${SEED.admin}"`);
  expect(lines[1]).toContain(`"${u.id}"`);
});

test("the System page shows configuration state but never secret values", async ({ adminPage: p }) => {
  await p.goto("/en/admin/system");
  await expect(p.locator("h1")).toHaveText(t("system.title"));
  await expect(p.locator("tr", { has: p.locator("code", { hasText: /^AUTH_SECRET$/ }) })).toContainText(t("system.set"));
  await expect(p.locator("#sys-rls").locator("..")).toContainText(t("system.noGrants"));
  const env = appDotEnv();
  const secrets: string[] = [];
  for (const k of ["AUTH_SECRET", "DATABASE_URL", "DIRECT_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CRON_SECRET", "SEED_PASSWORD"]) {
    const v = (env[k] ?? process.env[k] ?? "").trim();
    if (v.length >= 8) secrets.push(v);
  }
  // Database password / connection strings, however they are written.
  try { const pw = decodeURIComponent(new URL(databaseUrl()).password); if (pw.length >= 8) secrets.push(pw); } catch { /* not a URL */ }
  secrets.push(databaseUrl());
  expect(secrets.length).toBeGreaterThan(0);
  const dom = await p.content();
  const raw = await (await p.request.get("/en/admin/system")).text(); // HTML + React Server Components payload
  for (const s of secrets) {
    expect(dom.includes(s), "secret value in the rendered page").toBe(false);
    expect(raw.includes(s), "secret value in the HTML/RSC payload").toBe(false);
  }
});

test.describe("CSV exports and the data export are restricted", () => {
  const ADMIN_CSV = ["/api/admin/members.csv", "/api/admin/registrations.csv", "/api/admin/messages.csv", "/api/admin/audit.csv"];
  test("anonymous visitors, guests and members get 403; admins get CSV", async ({ request, memberPage, guestPage, adminPage }) => {
    const [ev] = await q<{ id: string }>(`SELECT id FROM "Event" WHERE slug = 'ai-risk-register'`);
    const urls = [...ADMIN_CSV, `/api/admin/events/${ev.id}/registrations.csv`];
    for (const url of urls) {
      expect((await request.get(url)).status(), `anonymous ${url}`).toBe(403);
      expect((await memberPage.request.get(url)).status(), `member ${url}`).toBe(403);
      expect((await guestPage.request.get(url)).status(), `guest ${url}`).toBe(403);
      const r = await adminPage.request.get(url);
      expect(r.status(), `admin ${url}`).toBe(200);
      expect(r.headers()["content-type"]).toContain("text/csv");
      expect(r.headers()["content-disposition"]).toContain("attachment");
    }
  });
});

test("cron endpoint refuses requests without the right secret", async ({ request }) => {
  const configured = !!(process.env.E2E_CRON_SECRET ?? process.env.CRON_SECRET ?? appDotEnv().CRON_SECRET ?? "").trim(); // E2E_CRON_SECRET = the secret the test server was started with
  const expected = configured ? 401 : 503; // 503 = cron disabled (no CRON_SECRET), 401 = wrong/missing token
  for (const headers of <Record<string, string>[]>[{}, { authorization: "Bearer wrong-secret" }, { authorization: "Basic abc" }, { authorization: "Bearer " }]) {
    const r = await request.get("/api/cron/expire-unpaid-orders", { headers });
    expect(r.status(), JSON.stringify(headers)).toBe(expected);
    expect((await r.json()).ok).toBe(false);
    expect(r.headers()["cache-control"]).toContain("no-store");
  }
});

test("cron prunes ended one-hour rate-limit buckets (pr: / pi:) and keeps live ones", async ({ request }) => {
  const secret = (process.env.E2E_CRON_SECRET || process.env.CRON_SECRET || "").trim(); // the secret the test server was started with
  test.skip(!secret, "set E2E_CRON_SECRET (the app's CRON_SECRET) to run the cron");
  const old = [`pr:e2e-${RUN}-prune-old@example.test`, `pi:e2e-${RUN}-prune-old`];
  const live = [`pr:e2e-${RUN}-prune-live@example.test`, `pi:e2e-${RUN}-prune-live`];
  try {
    // Ended windows (2 h ago) and live ones (10 min ago); round-8 SEC L2: the daily cron removes the ended ones.
    for (const [keys, ago] of [[old, "2 hours"], [live, "10 minutes"]] as const)
      for (const key of keys) await q(`INSERT INTO "LoginThrottle" (key, failures, "lastFailAt") VALUES ($1, 3, now() - $2::interval)`, [key, ago]);
    const r = await request.get("/api/cron/expire-unpaid-orders", { headers: { authorization: `Bearer ${secret}` }, timeout: 90_000 });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.throttlePruned).toBeGreaterThanOrEqual(2);
    const left = (await q<{ key: string }>(`SELECT key FROM "LoginThrottle" WHERE key = ANY($1) ORDER BY key`, [[...old, ...live]])).map((x) => x.key);
    expect(left).toEqual([...live].sort());
  } finally {
    await q(`DELETE FROM "LoginThrottle" WHERE key = ANY($1)`, [[...old, ...live]]);
  }
});

test("Row Level Security: the Supabase anon/authenticated roles cannot read any table", async () => {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const roles = (await client.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`)).rows.map((r: { rolname: string }) => r.rolname);
    test.skip(roles.length === 0, "not a Supabase database (no anon/authenticated roles)");
    const rls = (await client.query(`SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`)).rows as { name: string; rls: boolean }[];
    for (const tb of TABLES) expect(rls.find((r) => r.name === tb.name)?.rls, `RLS on ${tb.name}`).toBe(true);
    expect(rls.filter((r) => !r.rls).map((r) => r.name)).toEqual([]);
    for (const role of roles) for (const tb of TABLES) {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        const err = await client.query(`SELECT * FROM "${tb.name}" LIMIT 1`).then(() => null, (e: { code?: string }) => e);
        expect(err?.code, `${role} reading ${tb.name}`).toBe("42501"); // insufficient_privilege
      } finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
});
