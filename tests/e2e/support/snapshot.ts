/**
 * Database snapshot / restore so the suite leaves the database exactly as it found it.
 *
 * - snapshot(): every row of every app table as row_to_json text, keyed by primary key (taken in the global setup).
 * - diff(): rows added, changed or removed since the snapshot.
 * - restore(): deletes added rows (children first), re-inserts removed rows and resets changed rows to their snapshot
 *   values (json_populate_record, so every column type round-trips exactly), in one transaction. Strict mode only
 *   (E2E_RESTORE=strict): it would also remove rows written meanwhile by anyone else using the database.
 * - markerCleanup(): removes everything carrying the e2e markers or listed in the run ledger (default cleanup).
 */
import fs from "node:fs";
import path from "node:path";
import { getPool, q } from "./db";

/** Delete order (children before parents); inserts use the reverse order. */
export const TABLES = [
  { name: "ContentRevision", pk: "id" }, { name: "Registration", pk: "id" }, { name: "CpeEntry", pk: "id" },
  { name: "Membership", pk: "id" }, { name: "AuditLog", pk: "id" }, { name: "LoginThrottle", pk: "key" },
  { name: "ContactMessage", pk: "id" }, { name: "Setting", pk: "key" }, { name: "ContentPage", pk: "id" },
  { name: "Event", pk: "id" }, { name: "User", pk: "id" },
] as const;
export type TableName = (typeof TABLES)[number]["name"];
export type Snapshot = { takenAt: string; tables: Record<string, Record<string, string>> };
export type TableDiff = { added: string[]; removed: string[]; changed: string[] };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function rowsOf(client: { query: (s: string, p?: unknown[]) => Promise<{ rows: { k: string; j: string }[] }> }, table: string, pk: string) {
  const r = await client.query(`SELECT t.${ident(pk)}::text AS k, row_to_json(t)::text AS j FROM ${ident(table)} t`);
  return Object.fromEntries(r.rows.map((x) => [x.k, x.j]));
}

export async function snapshot(): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  for (const t of TABLES) tables[t.name] = await rowsOf(getPool(), t.name, t.pk);
  return { takenAt: new Date().toISOString(), tables };
}
export function saveSnapshot(s: Snapshot, file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s)); }
export function loadSnapshot(file: string): Snapshot | null { return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot) : null; }

export async function diff(s: Snapshot): Promise<Record<string, TableDiff>> {
  const out: Record<string, TableDiff> = {};
  for (const t of TABLES) {
    const now = await rowsOf(getPool(), t.name, t.pk); const was = s.tables[t.name] ?? {};
    out[t.name] = {
      added: Object.keys(now).filter((k) => !(k in was)),
      removed: Object.keys(was).filter((k) => !(k in now)),
      changed: Object.keys(now).filter((k) => k in was && was[k] !== now[k]),
    };
  }
  return out;
}
export const isClean = (d: Record<string, TableDiff>) => Object.values(d).every((x) => !x.added.length && !x.removed.length && !x.changed.length);

export async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t.name] = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM ${ident(t.name)}`))[0].n);
  return out;
}

/**
 * Put tables back to the snapshot. Without `only`: everything (strict mode). With `only`: just those rows of those tables
 * (re-inserted if removed, reset if changed); rows added since the snapshot are then left alone.
 */
export async function restore(s: Snapshot, only?: Partial<Record<TableName, string[]>>): Promise<Record<string, TableDiff>> {
  const full = await diff(s);
  const d: Record<string, TableDiff> = only
    ? Object.fromEntries(TABLES.map((t) => { const keep = new Set(only[t.name] ?? []); const x = full[t.name];
        return [t.name, { added: [], removed: x.removed.filter((k) => keep.has(k)), changed: x.changed.filter((k) => keep.has(k)) }]; }))
    : full;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const t of TABLES) {
      const ids = d[t.name].added;
      if (ids.length) await client.query(`DELETE FROM ${ident(t.name)} WHERE ${ident(t.pk)}::text = ANY($1::text[])`, [ids]);
    }
    for (const t of [...TABLES].reverse()) {
      if (!d[t.name].removed.length && !d[t.name].changed.length) continue;
      const cols = (await client.query(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t.name])).rows.map((r: { c: string }) => ident(r.c)).join(", ");
      for (const k of d[t.name].removed)
        await client.query(`INSERT INTO ${ident(t.name)} (${cols}) SELECT ${cols} FROM json_populate_record(NULL::${ident(t.name)}, $1::json)`, [s.tables[t.name][k]]);
      for (const k of d[t.name].changed)
        await client.query(`UPDATE ${ident(t.name)} SET (${cols}) = (SELECT ${cols} FROM json_populate_record(NULL::${ident(t.name)}, $1::json)) WHERE ${ident(t.pk)}::text = $2`, [s.tables[t.name][k], k]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  return d;
}

/**
 * Remove all e2e data by marker (no snapshot needed): e2e users (by email, or by id for rows created by the DB helper,
 * which stay findable after the app anonymizes a deleted account), their memberships/registrations/CPE (cascade),
 * e2e events, contact messages, login-throttle rows and audit rows written by or about any of them, plus the unmarked
 * rows listed in the run ledger (`extra`). Data of anyone else using the database is untouched.
 */
export async function markerCleanup(extra: { auditIds?: string[]; settingKeys?: string[]; contentPageIds?: string[] } = {}): Promise<Record<string, number>> {
  const client = await getPool().connect();
  const n: Record<string, number> = {};
  try {
    await client.query("BEGIN");
    const users = (await client.query(`SELECT id, email FROM "User" WHERE email LIKE 'e2e+%@example.test' OR id LIKE 'e2e-%'`)).rows as { id: string; email: string }[];
    const ids = users.map((u) => u.id); const emails = users.map((u) => u.email);
    const events = (await client.query(`SELECT id FROM "Event" WHERE slug LIKE 'e2e-%' OR title LIKE 'E2E %'`)).rows.map((r: { id: string }) => r.id);
    const related = (await client.query(
      `SELECT id FROM "Membership" WHERE "userId" = ANY($1) UNION SELECT id FROM "Registration" WHERE "userId" = ANY($1) OR "eventId" = ANY($2)`, [ids, events])).rows.map((r: { id: string }) => r.id);
    const msgs = (await client.query(`SELECT id FROM "ContactMessage" WHERE email LIKE 'e2e+%@example.test' OR "userId" = ANY($1)`, [ids])).rows.map((r: { id: string }) => r.id);
    const targets = [...ids, ...emails, ...events, ...related, ...msgs, ...ids.map((i) => `user:${i}`)];
    n.AuditLog = (await client.query(
      `DELETE FROM "AuditLog" WHERE actor = ANY($1) OR target = ANY($2) OR split_part(target, ' ', 1) = ANY($2) OR target LIKE 'e2e+%@example.test'
         OR actor LIKE 'e2e-%' OR target LIKE 'e2e-%' OR target LIKE 'user:e2e-%' OR id = ANY($3)`,
      [ids, targets, extra.auditIds ?? []])).rowCount ?? 0;
    n.Setting = (await client.query(`DELETE FROM "Setting" WHERE key = ANY($1)`, [extra.settingKeys ?? []])).rowCount ?? 0;
    n.ContentPage = (await client.query(`DELETE FROM "ContentPage" WHERE id = ANY($1)`, [extra.contentPageIds ?? []])).rowCount ?? 0; // cascades revisions
    n.ContactMessage = (await client.query(`DELETE FROM "ContactMessage" WHERE id = ANY($1)`, [msgs])).rowCount ?? 0;
    n.LoginThrottle = (await client.query(`DELETE FROM "LoginThrottle" WHERE key LIKE 'e:e2e+%@example.test' OR key = ANY($1)`, [emails.map((e) => `e:${e}`)])).rowCount ?? 0;
    n.Event = (await client.query(`DELETE FROM "Event" WHERE id = ANY($1)`, [events])).rowCount ?? 0; // cascades registrations; CPE eventId set null
    n.CpeEntry = (await client.query(`DELETE FROM "CpeEntry" WHERE "userId" = ANY($1)`, [ids])).rowCount ?? 0;
    n.User = (await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [ids])).rowCount ?? 0; // cascades memberships, registrations
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  return n;
}
