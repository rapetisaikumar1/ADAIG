/**
 * Global setup: check the app and database are up (and migrated), clean up after an earlier interrupted run, purge any
 * e2e-marked leftovers of earlier runs (local database only), make sure the seed accounts are usable (active; seed admins
 * are Super Admins), snapshot the database (used by the teardown to verify the cleanup) and sign in the seed roles once
 * (storageState).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { authFile, BASE_URL, browserOptions, SEED, SEED_PASSWORD, SNAPSHOT_FILE, STATE_DIR, REPORT_FILE, type Role } from "./support/env";
import { closeDb, q, SUPER_ADMIN_ROLE_ID } from "./support/db";
import { saveSnapshot, snapshot, tableCounts } from "./support/snapshot";
import { cleanupDatabase, purgeE2eLeftovers } from "./support/cleanup";
import { LEDGER_FILE } from "./support/ledger";
import { uiLogin } from "./support/login";

export default async function globalSetup() {
  process.env.E2E_RUN_ID ||= Date.now().toString(36);
  fs.mkdirSync(path.join(STATE_DIR, "auth"), { recursive: true });

  const health = await fetch(`${BASE_URL}/api/health`).catch((e: Error) => { throw new Error(`[e2e] App not reachable at ${BASE_URL} (${e.message}). Start it (npm run build && npm start) or set E2E_BASE_URL.`); });
  const body = (await health.json().catch(() => ({}))) as { db?: string };
  if (health.status !== 200 || body.db !== "up") throw new Error(`[e2e] ${BASE_URL}/api/health answered ${health.status} ${JSON.stringify(body)}; the app or its database is down.`);

  // Round 7 schema (AdminRole, User.active, User.adminRoleId) must be migrated, with the Super Admin system role.
  const schema = await q<{ roles: string | null; cols: string }>(
    `SELECT to_regclass('public."AdminRole"')::text AS roles,
            (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User' AND column_name IN ('active', 'adminRoleId'))::text AS cols`);
  if (!schema[0].roles || schema[0].cols !== "2") throw new Error(`[e2e] The E2E database is not migrated (no AdminRole table / User.active / User.adminRoleId). Run prisma migrate deploy on it (local URL).`);
  // Round 8 schema (EmailLog, PasswordResetToken): snapshotted and cleaned like the other tables.
  const mail = await q<{ log: string | null; tok: string | null }>(`SELECT to_regclass('public."EmailLog"')::text AS log, to_regclass('public."PasswordResetToken"')::text AS tok`);
  if (!mail[0].log || !mail[0].tok) throw new Error(`[e2e] The E2E database is not migrated (no EmailLog / PasswordResetToken table, round 8 migration 20261112180000_email). Run prisma migrate deploy on it (local URL).`);
  if (!(await q(`SELECT 1 FROM "AdminRole" WHERE id = $1 AND "isSystem"`, [SUPER_ADMIN_ROLE_ID])).length) throw new Error(`[e2e] The Super Admin system role (${SUPER_ADMIN_ROLE_ID}) is missing. Re-run the admin_rbac migration or npm run db:seed on the local database.`);

  const seeds = await q<{ email: string; role: string }>(`SELECT email, role FROM "User" WHERE email = ANY($1)`, [Object.values(SEED)]);
  if (seeds.length !== Object.values(SEED).length) throw new Error(`[e2e] Seed accounts missing (found ${seeds.map((s) => s.email).join(", ") || "none"}). Run npm run db:seed on a local database.`);
  const locked = await q<{ key: string }>(`SELECT key FROM "LoginThrottle" WHERE key = ANY($1) AND "lockedUntil" > now()`, [Object.values(SEED).map((e) => `e:${e}`)]);
  if (locked.length) throw new Error(`[e2e] Seed account locked: ${locked.map((l) => l.key.slice(2)).join(", ")}. Run npm run unlock -- <email>.`);

  if (fs.existsSync(SNAPSHOT_FILE) || fs.existsSync(LEDGER_FILE)) {
    // A previous run did not reach (or finish) its teardown: remove what it wrote before taking a new snapshot.
    const r = await cleanupDatabase();
    console.warn(`[e2e] Cleaned up after an unfinished earlier run: ${JSON.stringify(r.removed)}`);
  }
  // Leftovers of earlier runs that left no state files (killed runs, E2E_KEEP_DATA, another checkout): e2e markers only.
  const purged = await purgeE2eLeftovers();
  if (Object.keys(purged).length) console.warn(`[e2e] Purged e2e leftovers of earlier runs: ${JSON.stringify(purged)}`);
  // Seed accounts must be usable: active, and the seed admins Super Admins (as prisma/seed.ts creates them). A run killed
  // inside a test's try/finally could leave them otherwise; repair before the snapshot so the teardown restores this state.
  const repaired = await q<{ email: string }>(
    `UPDATE "User" SET active = true, "adminRoleId" = CASE WHEN role = 'admin' THEN $2 ELSE "adminRoleId" END
      WHERE email = ANY($1) AND (NOT active OR (role = 'admin' AND "adminRoleId" IS DISTINCT FROM $2)) RETURNING email`,
    [Object.values(SEED), SUPER_ADMIN_ROLE_ID]);
  if (repaired.length) console.warn(`[e2e] Repaired seed accounts (reactivated / Super Admin role restored): ${repaired.map((r) => r.email).join(", ")}`);
  saveSnapshot(await snapshot(), SNAPSHOT_FILE);
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ run: process.env.E2E_RUN_ID, before: await tableCounts() }, null, 2));
  await closeDb();

  const { channel, launchOptions } = browserOptions();
  const browser = await chromium.launch({ ...(launchOptions ?? {}), ...(channel ? { channel } : {}) });
  try {
    for (const [role, email] of [["admin", SEED.admin], ["member", SEED.member], ["guest", SEED.guest]] as [Role, string][]) {
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const page = await ctx.newPage();
      // Each role lands on its portal home: admins on Admin → Members, members and guests on My membership.
      await uiLogin(page, { email, password: SEED_PASSWORD }, { expectUrl: new RegExp(`/en/${role === "admin" ? "admin/members" : "my/billing"}$`) });
      await ctx.storageState({ path: authFile(role) });
      await ctx.close();
    }
  } finally { await browser.close(); }
}
