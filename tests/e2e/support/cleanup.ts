/**
 * Database cleanup shared by the global teardown and `npm run test:e2e:cleanup`.
 *
 * Default (attributed): removes exactly what the suite wrote, so other people/agents using the same database keep their data:
 *   1. Setting overrides left by a failed test are reset through the admin UI (expires the app's data cache);
 *   2. every e2e-marked row and every ledger row is deleted (markerCleanup), including test ContentPage overrides (deleted
 *      directly in the DB: the admin Content editor no longer exists, so the public pages may serve their cached copy for up
 *      to the 5-minute revalidate) and e2e admin roles (after the users holding them);
 *   3. seed accounts (incl. their role, adminRoleId and active flag), seed events and seed admin roles changed by the run are
 *      put back to their snapshot values;
 *   4. the database is compared with the snapshot: e2e rows must be gone; differences written by others are reported.
 * Strict (E2E_RESTORE=strict, for a database used only by the suite, e.g. CI): additionally restores every table to the
 * snapshot exactly and fails unless the database is identical to it.
 */
import fs from "node:fs";
import { SNAPSHOT_FILE, strictlyLocalDatabaseUrl } from "./env";
import { q } from "./db";
import { diff, E2E_ROLE_SQL, E2E_USER_SQL, loadSnapshot, markerCleanup, restore, snapshotMismatch, tableCounts, type Snapshot, type TableDiff } from "./snapshot";
import { resetOverridesViaUi } from "./cacheReset";
import { clearLedger, collectSince, dbNow, readLedger, SEED_ROLE_NAMES, seedRefs } from "./ledger";

const summarize = (d: Record<string, TableDiff>) =>
  Object.fromEntries(Object.entries(d).filter(([, x]) => x.added.length || x.removed.length || x.changed.length)
    .map(([k, x]) => [k, { added: x.added.length, removed: x.removed.length, changed: x.changed.length }]));

/** e2e rows still present (must be 0 after cleanup). */
async function leftovers(ledger: { table: string; pk: string }[]) {
  const ids = (t: string) => ledger.filter((e) => e.table === t).map((e) => e.pk);
  const n = async (sql: string, p: unknown[] = []) => Number((await q<{ n: string }>(sql, p))[0].n);
  return {
    users: await n(`SELECT count(*) AS n FROM "User" WHERE ${E2E_USER_SQL}`),
    roles: await n(`SELECT count(*) AS n FROM "AdminRole" WHERE ${E2E_ROLE_SQL} OR (NOT "isSystem" AND id = ANY($1))`, [ids("AdminRole")]),
    events: await n(`SELECT count(*) AS n FROM "Event" WHERE slug LIKE 'e2e-%' OR title LIKE 'E2E %'`),
    messages: await n(`SELECT count(*) AS n FROM "ContactMessage" WHERE email LIKE 'e2e+%@example.test'`),
    loginThrottle: await n(`SELECT count(*) AS n FROM "LoginThrottle" WHERE key LIKE 'e:e2e+%@example.test'`),
    audit: await n(`SELECT count(*) AS n FROM "AuditLog" WHERE id = ANY($1) OR target LIKE 'e2e+%@example.test' OR actor LIKE 'e2e-%' OR target LIKE 'e2e-%' OR target LIKE 'user:e2e-%'`, [ids("AuditLog")]),
    settings: await n(`SELECT count(*) AS n FROM "Setting" WHERE key = ANY($1)`, [ids("Setting")]),
    contentPages: await n(`SELECT count(*) AS n FROM "ContentPage" WHERE id = ANY($1) OR id LIKE 'e2e-%'`, [ids("ContentPage")]),
  };
}

/** Seed admin roles as they were in the snapshot (Super Admin + the seeded examples), so a role a test changed or deleted comes back. */
const seedRoleIds = (snap: Snapshot) => Object.entries(snap.tables.AdminRole ?? {})
  .filter(([, j]) => { const r = JSON.parse(j) as { isSystem?: boolean; name?: string }; return !!r.isSystem || SEED_ROLE_NAMES.includes(r.name ?? ""); })
  .map(([k]) => k);

export async function cleanupDatabase() {
  const strict = process.env.E2E_RESTORE === "strict";
  let snap = loadSnapshot(SNAPSHOT_FILE);
  const mismatch = snap && (await snapshotMismatch(snap));
  if (mismatch) { console.warn(`[e2e] Ignoring the saved snapshot (${mismatch}); cleaning up by e2e markers and the ledger only.`); snap = null; }
  const ledger = readLedger();
  const uniq = (t: string) => [...new Set(ledger.filter((e) => e.table === t).map((e) => e.pk))];
  // Setting keys are names, not ids: never apply another database's ledger keys here.
  const settingKeys = mismatch ? [] : uniq("Setting"), contentPageIds = uniq("ContentPage"), roleIds = uniq("AdminRole");

  // 1. Setting overrides still present → reset via the admin UI (keeps the running app's cache consistent).
  //    ContentPage overrides are deleted directly in step 2 (there is no admin content UI any more).
  const stillSettings = (await q<{ key: string }>(`SELECT key FROM "Setting" WHERE key = ANY($1)`, [settingKeys])).map((r) => r.key);
  const t0 = await dbNow();
  let uiResets: string[] = [];
  try { uiResets = await resetOverridesViaUi({ settings: stillSettings }); }
  catch (e) { console.warn(`[e2e] Could not reset overrides through the admin UI (${(e as Error).message}); the app may show cached values until the next admin save.`); }
  const resetRows = uiResets.length ? await collectSince(t0) : [];

  // 2. Everything this run wrote.
  const allLedger = [...ledger, ...resetRows];
  const removed = await markerCleanup({
    auditIds: allLedger.filter((e) => e.table === "AuditLog").map((e) => e.pk), settingKeys, contentPageIds, roleIds,
  });

  // 3. Seed rows the suite may have changed (strict: every table).
  let restored: Record<string, unknown> = {};
  if (snap) {
    const s = await seedRefs();
    restored = summarize(strict ? await restore(snap) : await restore(snap, { User: s.users, Event: s.events, AdminRole: seedRoleIds(snap) }));
  }

  // 4. Verify.
  const leaked = await leftovers(allLedger);
  const leakedTotal = Object.values(leaked).reduce((a, b) => a + b, 0);
  const remaining = snap ? summarize(await diff(snap)) : {};
  const identical = !!snap && Object.keys(remaining).length === 0;
  if (leakedTotal === 0) { clearLedger(); fs.rmSync(SNAPSHOT_FILE, { force: true }); }
  return { mode: strict ? "strict" : "attributed", identical, leaked, leakedTotal, removed, restored, uiResets, remaining, after: await tableCounts() };
}

/**
 * Pre-run purge (global setup): remove every e2e-marked row left by EARLIER runs whose teardown never ran or whose state
 * files were lost (users "e2e+…@example.test" / "e2e-…" ids, "E2E …" admin roles, e2e events, messages, throttle rows,
 * ContentPage rows with "e2e-" ids and their audit rows). Marker-based only: rows without an e2e marker are never touched.
 * Local databases only, without override: it refuses any E2E_DATABASE_URL whose host is not this machine.
 */
export async function purgeE2eLeftovers(): Promise<Record<string, number>> {
  strictlyLocalDatabaseUrl();
  const removed = await markerCleanup();
  return Object.fromEntries(Object.entries(removed).filter(([, v]) => v > 0));
}
