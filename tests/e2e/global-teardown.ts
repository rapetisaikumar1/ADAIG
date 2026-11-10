/**
 * Global teardown: remove everything the run wrote (see support/cleanup.ts), verify, print before/after table counts.
 * E2E_KEEP_DATA=1 skips the cleanup (to inspect what a failing test left behind; then run npm run test:e2e:cleanup).
 */
import fs from "node:fs";
import { REPORT_FILE, SNAPSHOT_FILE } from "./support/env";
import { closeDb } from "./support/db";
import { cleanupDatabase } from "./support/cleanup";

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA === "1") { console.log(`[e2e] E2E_KEEP_DATA=1: database left as is (snapshot kept in ${SNAPSHOT_FILE}).`); return; }
  try {
    const r = await cleanupDatabase();
    const prev = fs.existsSync(REPORT_FILE) ? JSON.parse(fs.readFileSync(REPORT_FILE, "utf8")) : {};
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ ...prev, ...r }, null, 2));
    console.log(`\n[e2e] Database cleanup (${r.mode}): removed ${JSON.stringify(r.removed)}; seed rows restored ${JSON.stringify(r.restored)}${r.uiResets.length ? `; overrides reset via admin UI: ${r.uiResets.join(", ")}` : ""}`);
    console.log(`[e2e] Table counts before: ${JSON.stringify(prev.before ?? {})}`);
    console.log(`[e2e] Table counts after:  ${JSON.stringify(r.after)}`);
    console.log(r.identical ? "[e2e] Database is identical to the pre-run snapshot." : `[e2e] Differences from the pre-run snapshot not written by this run (someone else used the database meanwhile): ${JSON.stringify(r.remaining)}`);
    if (r.leakedTotal) throw new Error(`[e2e] e2e data left in the database after cleanup: ${JSON.stringify(r.leaked)}`);
    if (r.mode === "strict" && !r.identical) throw new Error(`[e2e] Strict mode: database differs from the snapshot: ${JSON.stringify(r.remaining)}`);
  } finally { await closeDb(); }
}
