/**
 * Run ledger: rows the suite created that carry no e2e marker (audit entries written by the seed admin for settings,
 * content and exports, Setting / ContentPage overrides). An automatic fixture appends them after every test, so the
 * teardown can remove exactly what this run wrote, even while someone else uses the same database.
 */
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./env";
import { q } from "./db";

export const LEDGER_FILE = path.join(STATE_DIR, "ledger.jsonl");
export type LedgerEntry = { table: "AuditLog" | "Setting" | "ContentPage"; pk: string };

export function appendLedger(entries: LedgerEntry[]) {
  if (!entries.length) return;
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  fs.appendFileSync(LEDGER_FILE, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
export function readLedger(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  return fs.readFileSync(LEDGER_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
}
export const clearLedger = () => fs.rmSync(LEDGER_FILE, { force: true });

/** Seed accounts and seed events (ids), read once per worker. */
let seedIds: Promise<{ users: string[]; admins: string[]; events: string[] }> | null = null;
export function seedRefs() {
  seedIds ??= (async () => {
    const users = await q<{ id: string; role: string }>(`SELECT id, role FROM "User" WHERE email = ANY($1)`, [["admin@adaig.test", "admin2@adaig.test", "member@adaig.test", "guest@adaig.test"]]);
    const events = await q<{ id: string }>(`SELECT id FROM "Event" WHERE slug = ANY($1)`, [["ai-risk-register", "records-retention-genai", "new-york-meetup", "summit-2027"]]);
    return { users: users.map((u) => u.id), admins: users.filter((u) => u.role === "admin").map((u) => u.id), events: events.map((e) => e.id) };
  })();
  return seedIds;
}

export const dbNow = async () => (await q<{ now: Date }>("SELECT now() AS now"))[0].now;

/**
 * Rows written by seed accounts during [since, now] that this suite produces and that have no e2e marker:
 * settings / content audit entries and overrides, CSV export entries, actions targeting seed accounts or events.
 */
export async function collectSince(since: Date): Promise<LedgerEntry[]> {
  const s = await seedRefs();
  const audit = await q<{ id: string }>(
    `SELECT id FROM "AuditLog" WHERE "createdAt" >= $1 AND actor = ANY($2) AND (
       target IS NULL OR target LIKE 'rows:%' OR target LIKE 'tier.%' OR target IN ('tiers', 'site.contact', 'ops')
       OR target ~ '^(en|fr)/[a-z0-9-]+$' OR target = ANY($2) OR target = ANY($3))`,
    [since, s.users, s.events],
  );
  const settings = await q<{ key: string }>(`SELECT key FROM "Setting" WHERE "updatedAt" >= $1 AND "updatedBy" = ANY($2)`, [since, s.admins]);
  const pages = await q<{ id: string }>(`SELECT id FROM "ContentPage" WHERE "createdAt" >= $1 AND "updatedBy" = ANY($2)`, [since, s.admins]);
  return [
    ...audit.map((r) => ({ table: "AuditLog" as const, pk: r.id })),
    ...settings.map((r) => ({ table: "Setting" as const, pk: r.key })),
    ...pages.map((r) => ({ table: "ContentPage" as const, pk: r.id })),
  ];
}
