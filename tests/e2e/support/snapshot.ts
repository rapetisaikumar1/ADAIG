/**
 * Database snapshot / restore so the suite leaves the database exactly as it found it.
 *
 * - snapshot(): every row of every app table as row_to_json text, keyed by primary key (taken in the global setup).
 * - diff(): rows added, changed or removed since the snapshot.
 * - restore(): deletes added rows (children first), re-inserts removed rows and resets changed rows to their snapshot
 *   values (json_populate_record, so every column type round-trips exactly), in one transaction. Strict mode only
 *   (E2E_RESTORE=strict): it would also remove rows written meanwhile by anyone else using the database.
 * - markerCleanup(): removes everything carrying the e2e markers or listed in the run ledger (default cleanup, and the
 *   pre-run purge of an earlier run's leftovers).
 */
import fs from "node:fs";
import path from "node:path";
import { getPool, q, SUPER_ADMIN_ROLE_ID } from "./db";
import { databaseUrl, SEED } from "./env";

/** Delete order (children before parents); inserts use the reverse order. AdminRole is the parent of User (User.adminRoleId, FK RESTRICT). */
export const TABLES = [
  { name: "ContentRevision", pk: "id" }, { name: "Registration", pk: "id" }, { name: "CpeEntry", pk: "id" },
  { name: "Membership", pk: "id" }, { name: "AuditLog", pk: "id" }, { name: "LoginThrottle", pk: "key" },
  { name: "ContactMessage", pk: "id" }, { name: "Setting", pk: "key" }, { name: "ContentPage", pk: "id" },
  { name: "Event", pk: "id" }, { name: "User", pk: "id" }, { name: "AdminRole", pk: "id" },
] as const;

/** SQL for the e2e user markers (also used by the leftover check). */
export const E2E_USER_SQL = `email LIKE 'e2e+%@example.test' OR id LIKE 'e2e-%' OR (name LIKE 'E2E %' AND email LIKE '%@example.test')`;
/** SQL for the e2e admin role markers. The system role is never matched. */
export const E2E_ROLE_SQL = `NOT "isSystem" AND (id LIKE 'e2e-%' OR name LIKE 'E2E %')`;
export type TableName = (typeof TABLES)[number]["name"];
/** `db` identifies the database the snapshot was taken from (a snapshot is never applied to another database). */
export type Snapshot = { takenAt: string; db?: string; tables: Record<string, Record<string, string>> };
export type TableDiff = { added: string[]; removed: string[]; changed: string[] };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function rowsOf(client: { query: (s: string, p?: unknown[]) => Promise<{ rows: { k: string; j: string }[] }> }, table: string, pk: string) {
  const r = await client.query(`SELECT t.${ident(pk)}::text AS k, row_to_json(t)::text AS j FROM ${ident(table)} t`);
  return Object.fromEntries(r.rows.map((x) => [x.k, x.j]));
}

/** "<host>:<port>/<current_database()>" of the E2E database. */
export async function dbIdentity(): Promise<string> {
  const r = await q<{ db: string; port: number | null }>(`SELECT current_database() AS db, inet_server_port() AS port`);
  let host = "";
  try { host = new URL(databaseUrl()).hostname; } catch { /* unparsable URLs are refused by databaseUrl() anyway */ }
  return `${host}:${r[0].port ?? ""}/${r[0].db}`;
}

export async function snapshot(): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  for (const t of TABLES) tables[t.name] = await rowsOf(getPool(), t.name, t.pk);
  return { takenAt: new Date().toISOString(), db: await dbIdentity(), tables };
}

/** Why a saved snapshot must not be used for this database (taken from another database, or before a table existed), or null. */
export async function snapshotMismatch(s: Snapshot): Promise<string | null> {
  const here = await dbIdentity();
  if (s.db && s.db !== here) return `it was taken from ${s.db}, not ${here}`;
  const missing = TABLES.filter((t) => !(t.name in s.tables)).map((t) => t.name);
  return missing.length ? `it has no ${missing.join(", ")} table (taken before a migration)` : null;
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
    // A pre-existing user moved to a role created during the run (changed row) would block that role's deletion (FK RESTRICT):
    // detach first; every such user is either added (deleted below) or changed (reset to its snapshot role below).
    if (d.AdminRole.added.length) await client.query(`UPDATE "User" SET "adminRoleId" = NULL WHERE "adminRoleId" = ANY($1::text[])`, [d.AdminRole.added]);
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
 * e2e admin roles ("e2e-" id or "E2E " name, never the system role), e2e events, contact messages, login-throttle rows,
 * test ContentPage overrides ("e2e-" ids) and audit rows written by or about any of them, plus the unmarked rows listed in
 * the run ledger (`extra`). Data of anyone else using the database is untouched.
 * FK order: e2e users are deleted before e2e roles; any other user still holding an e2e role is detached first (seed admins
 * get Super Admin back, anyone else no role = no permissions) so the RESTRICT FK can't block the cleanup.
 */
export async function markerCleanup(extra: { auditIds?: string[]; settingKeys?: string[]; contentPageIds?: string[]; roleIds?: string[] } = {}): Promise<Record<string, number>> {
  const client = await getPool().connect();
  const n: Record<string, number> = {};
  try {
    await client.query("BEGIN");
    const users = (await client.query(`SELECT id, email FROM "User" WHERE ${E2E_USER_SQL}`)).rows as { id: string; email: string }[];
    const roles = (await client.query(`SELECT id FROM "AdminRole" WHERE ${E2E_ROLE_SQL} OR (NOT "isSystem" AND id = ANY($1))`, [extra.roleIds ?? []])).rows.map((r: { id: string }) => r.id);
    const ids = users.map((u) => u.id); const emails = users.map((u) => u.email);
    const events = (await client.query(`SELECT id FROM "Event" WHERE slug LIKE 'e2e-%' OR title LIKE 'E2E %'`)).rows.map((r: { id: string }) => r.id);
    const related = (await client.query(
      `SELECT id FROM "Membership" WHERE "userId" = ANY($1) UNION SELECT id FROM "Registration" WHERE "userId" = ANY($1) OR "eventId" = ANY($2)`, [ids, events])).rows.map((r: { id: string }) => r.id);
    const msgs = (await client.query(`SELECT id FROM "ContactMessage" WHERE email LIKE 'e2e+%@example.test' OR "userId" = ANY($1)`, [ids])).rows.map((r: { id: string }) => r.id);
    const targets = [...ids, ...emails, ...events, ...related, ...msgs, ...roles, ...ids.map((i) => `user:${i}`)];
    n.AuditLog = (await client.query(
      `DELETE FROM "AuditLog" WHERE actor = ANY($1) OR target = ANY($2) OR split_part(target, ' ', 1) = ANY($2) OR target LIKE 'e2e+%@example.test'
         OR actor LIKE 'e2e-%' OR target LIKE 'e2e-%' OR target LIKE 'user:e2e-%' OR id = ANY($3)`,
      [ids, targets, extra.auditIds ?? []])).rowCount ?? 0;
    n.Setting = (await client.query(`DELETE FROM "Setting" WHERE key = ANY($1)`, [extra.settingKeys ?? []])).rowCount ?? 0;
    n.ContentPage = (await client.query(`DELETE FROM "ContentPage" WHERE id = ANY($1) OR id LIKE 'e2e-%'`, [extra.contentPageIds ?? []])).rowCount ?? 0; // cascades revisions
    n.ContactMessage = (await client.query(`DELETE FROM "ContactMessage" WHERE id = ANY($1)`, [msgs])).rowCount ?? 0;
    n.LoginThrottle = (await client.query(`DELETE FROM "LoginThrottle" WHERE key LIKE 'e:e2e+%@example.test' OR key = ANY($1)`, [emails.map((e) => `e:${e}`)])).rowCount ?? 0;
    n.Event = (await client.query(`DELETE FROM "Event" WHERE id = ANY($1)`, [events])).rowCount ?? 0; // cascades registrations; CPE eventId set null
    n.CpeEntry = (await client.query(`DELETE FROM "CpeEntry" WHERE "userId" = ANY($1)`, [ids])).rowCount ?? 0;
    n.User = (await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [ids])).rowCount ?? 0; // cascades memberships, registrations
    if (roles.length) {
      n.UserRoleDetached = (await client.query(
        `UPDATE "User" SET "adminRoleId" = CASE WHEN role = 'admin' AND email = ANY($2) THEN $3 ELSE NULL END WHERE "adminRoleId" = ANY($1)`,
        [roles, Object.values(SEED), SUPER_ADMIN_ROLE_ID])).rowCount ?? 0;
    }
    n.AdminRole = (await client.query(`DELETE FROM "AdminRole" WHERE id = ANY($1) AND NOT "isSystem"`, [roles])).rowCount ?? 0;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  return n;
}
