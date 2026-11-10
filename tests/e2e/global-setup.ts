/**
 * Global setup: check the app and database are up, clean up after an earlier interrupted run, snapshot the database
 * (used by the teardown to verify the cleanup) and sign in the seed roles once (storageState).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { authFile, BASE_URL, browserOptions, SEED, SEED_PASSWORD, SNAPSHOT_FILE, STATE_DIR, REPORT_FILE, type Role } from "./support/env";
import { closeDb, q } from "./support/db";
import { saveSnapshot, snapshot, tableCounts } from "./support/snapshot";
import { cleanupDatabase } from "./support/cleanup";
import { LEDGER_FILE } from "./support/ledger";
import { uiLogin } from "./support/login";

export default async function globalSetup() {
  process.env.E2E_RUN_ID ||= Date.now().toString(36);
  fs.mkdirSync(path.join(STATE_DIR, "auth"), { recursive: true });

  const health = await fetch(`${BASE_URL}/api/health`).catch((e: Error) => { throw new Error(`[e2e] App not reachable at ${BASE_URL} (${e.message}). Start it (npm run build && npm start) or set E2E_BASE_URL.`); });
  const body = (await health.json().catch(() => ({}))) as { db?: string };
  if (health.status !== 200 || body.db !== "up") throw new Error(`[e2e] ${BASE_URL}/api/health answered ${health.status} ${JSON.stringify(body)}; the app or its database is down.`);

  const seeds = await q<{ email: string; role: string }>(`SELECT email, role FROM "User" WHERE email = ANY($1)`, [Object.values(SEED)]);
  if (seeds.length !== Object.values(SEED).length) throw new Error(`[e2e] Seed accounts missing (found ${seeds.map((s) => s.email).join(", ") || "none"}). Run npm run db:seed on a local database.`);
  const locked = await q<{ key: string }>(`SELECT key FROM "LoginThrottle" WHERE key = ANY($1) AND "lockedUntil" > now()`, [Object.values(SEED).map((e) => `e:${e}`)]);
  if (locked.length) throw new Error(`[e2e] Seed account locked: ${locked.map((l) => l.key.slice(2)).join(", ")}. Run npm run unlock -- <email>.`);

  if (fs.existsSync(SNAPSHOT_FILE) || fs.existsSync(LEDGER_FILE)) {
    // A previous run did not reach (or finish) its teardown: remove what it wrote before taking a new snapshot.
    const r = await cleanupDatabase();
    console.warn(`[e2e] Cleaned up after an unfinished earlier run: ${JSON.stringify(r.removed)}`);
  }
  saveSnapshot(await snapshot(), SNAPSHOT_FILE);
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ run: process.env.E2E_RUN_ID, before: await tableCounts() }, null, 2));
  await closeDb();

  const { channel, launchOptions } = browserOptions();
  const browser = await chromium.launch({ ...(launchOptions ?? {}), ...(channel ? { channel } : {}) });
  try {
    for (const [role, email] of [["admin", SEED.admin], ["member", SEED.member], ["guest", SEED.guest]] as [Role, string][]) {
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const page = await ctx.newPage();
      await uiLogin(page, { email, password: SEED_PASSWORD });
      await ctx.storageState({ path: authFile(role) });
      await ctx.close();
    }
  } finally { await browser.close(); }
}
