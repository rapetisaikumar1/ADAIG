/**
 * Run ledger: rows the suite created that carry no e2e marker (audit entries written by the seed admin for settings,
 * content, exports and Users/Roles work, Setting / ContentPage overrides, admin roles created through the UI). An automatic fixture appends them after every test, so the
 * teardown can remove exactly what this run wrote, even while someone else uses the same database.
 */
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./env";
import { q } from "./db";

export const LEDGER_FILE = path.join(STATE_DIR, "ledger.jsonl");
export type LedgerEntry = { table: "AuditLog" | "Setting" | "ContentPage" | "AdminRole" | "EmailLog" | "PasswordResetToken"; pk: string };

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

/** Admin roles created by prisma/seed.ts (besides the Super Admin system role). */
export const SEED_ROLE_NAMES = ["Member Manager", "Event Manager", "Viewer"];

/** Seed accounts, seed events and seed admin roles (ids), read once per worker. */
let seedIds: Promise<{ users: string[]; admins: string[]; events: string[]; roles: string[] }> | null = null;
export function seedRefs() {
  seedIds ??= (async () => {
    const users = await q<{ id: string; role: string }>(`SELECT id, role FROM "User" WHERE email = ANY($1)`, [["admin@adaig.test", "admin2@adaig.test", "member@adaig.test", "guest@adaig.test"]]);
    const events = await q<{ id: string }>(`SELECT id FROM "Event" WHERE slug = ANY($1)`, [["ai-risk-register", "records-retention-genai", "new-york-meetup", "summit-2027"]]);
    const roles = await q<{ id: string }>(`SELECT id FROM "AdminRole" WHERE "isSystem" OR name = ANY($1)`, [SEED_ROLE_NAMES]);
    return { users: users.map((u) => u.id), admins: users.filter((u) => u.role === "admin").map((u) => u.id), events: events.map((e) => e.id), roles: roles.map((r) => r.id) };
  })();
  return seedIds;
}

export const dbNow = async () => (await q<{ now: Date }>("SELECT now() AS now"))[0].now;

/**
 * Rows written by seed accounts during [since, now] that this suite produces and that have no e2e marker:
 * settings / content audit entries and overrides, CSV export entries, actions targeting seed accounts, events or seed
 * roles, Users / Roles audit entries (a role created and deleted in a test leaves no marked row to find them by), and the
 * admin roles created through the UI by a seed or e2e account (from their `admin_role.created` audit row).
 * Round 8: emails the run sent to or about the seed accounts (EmailLog rows by userId / address, or keyed on one of the audit
 * rows above), and password reset tokens of seed accounts. Emails about e2e data are found by markerCleanup itself.
 */
export async function collectSince(since: Date): Promise<LedgerEntry[]> {
  const s = await seedRefs();
  const audit = await q<{ id: string }>(
    `SELECT id FROM "AuditLog" WHERE "createdAt" >= $1 AND actor = ANY($2) AND (
       target IS NULL OR target LIKE 'rows:%' OR target LIKE 'tier.%' OR target IN ('tiers', 'site.contact', 'ops')
       OR target ~ '^(en|fr)/[a-z0-9-]+$' OR target = ANY($2) OR target = ANY($3) OR target = ANY($4)
       OR action LIKE 'admin_role.%' OR action LIKE 'admin_user.%' OR action = 'admin.permission_denied')`,
    [since, s.users, s.events, s.roles],
  );
  const roles = await q<{ id: string }>(
    `SELECT DISTINCT split_part(a.target, ' ', 1) AS id FROM "AuditLog" a WHERE a."createdAt" >= $1 AND a.action = 'admin_role.created'
       AND (a.actor = ANY($2) OR a.actor IN (SELECT id FROM "User" WHERE email LIKE 'e2e_%@example.test' OR id LIKE 'e2e-%'))
       AND split_part(a.target, ' ', 1) <> ALL($3)`,
    [since, s.users, s.roles],
  );
  const settings = await q<{ key: string }>(`SELECT key FROM "Setting" WHERE "updatedAt" >= $1 AND "updatedBy" = ANY($2)`, [since, s.admins]);
  const pages = await q<{ id: string }>(`SELECT id FROM "ContentPage" WHERE "createdAt" >= $1 AND "updatedBy" = ANY($2)`, [since, s.admins]);
  const seedEmails = await q<{ email: string }>(`SELECT lower(email) AS email FROM "User" WHERE id = ANY($1)`, [s.users]);
  const emails = await q<{ id: string }>(
    `SELECT id FROM "EmailLog" WHERE "createdAt" >= $1 AND ("userId" = ANY($2) OR lower("toEmail") = ANY($3) OR split_part("dedupeKey", ':', 2) = ANY($4))`,
    [since, s.users, seedEmails.map((r) => r.email), audit.map((r) => r.id)],
  );
  const tokens = await q<{ id: string }>(`SELECT id FROM "PasswordResetToken" WHERE "createdAt" >= $1 AND "userId" = ANY($2)`, [since, s.users]);
  return [
    ...audit.map((r) => ({ table: "AuditLog" as const, pk: r.id })),
    ...settings.map((r) => ({ table: "Setting" as const, pk: r.key })),
    ...pages.map((r) => ({ table: "ContentPage" as const, pk: r.id })),
    ...roles.filter((r) => r.id).map((r) => ({ table: "AdminRole" as const, pk: r.id })),
    ...emails.map((r) => ({ table: "EmailLog" as const, pk: r.id })),
    ...tokens.map((r) => ({ table: "PasswordResetToken" as const, pk: r.id })),
  ];
}
