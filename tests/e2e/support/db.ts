/**
 * Direct database access for setup, assertions and cleanup (node-postgres, the driver the app itself uses).
 * Rows created here use the e2e markers (ids "e2e-…", emails "e2e+<run>-<n>@example.test", event slugs "e2e-…", admin role
 * names "E2E …"), so the global teardown, `npm run test:e2e:cleanup` and the pre-run purge can always find them.
 * Rules for spec authors: README → Testing.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { databaseUrl } from "./env";
import { FULL_PERMISSIONS, SUPER_ADMIN_NAME, SUPER_ADMIN_ROLE_ID, type Action, type Module } from "../../../src/lib/permissions";

export { SUPER_ADMIN_NAME, SUPER_ADMIN_ROLE_ID };

let pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: databaseUrl(), max: 3 });
  return pool;
}
export async function closeDb() { if (pool) { const p = pool; pool = null; await p.end(); } }

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await getPool().query(sql, params)).rows as T[];
}
export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}
export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await one<{ n: string | number }>(sql, params);
  return Number(r?.n ?? 0);
}

/* ── unique test data ───────────────────────────────────────────────────────────── */

/** One id per test run (set by the global setup so every worker shares it). */
export const RUN = (process.env.E2E_RUN_ID ||= Date.now().toString(36));
let n = 0;
/** Unique within the run, also across worker restarts (retries start a new worker process). */
const nextN = () => `${crypto.randomBytes(3).toString("hex")}${++n}`;
export const uniqueEmail = () => `e2e+${RUN}-${nextN()}@example.test`;
export const uniqueName = (label = "User") => `E2E ${label} ${RUN}${nextN()}`;
export const uniqueSlug = () => `e2e-${RUN}-${nextN()}`;
export const e2eId = () => `e2e-${crypto.randomUUID()}`;
/** A password that passes the app's rules (12+ chars, not on the blocklist). */
export const uniquePassword = () => `E2e-pass-${crypto.randomBytes(6).toString("hex")}!`;

/* ── factories ─────────────────────────────────────────────────────────────────── */

export type UserRow = { id: string; email: string; name: string; role: string; passwordHash: string; sessionVersion: number; organisation: string | null; jobTitle: string | null; country: string; province: string | null; locale: string; directoryOptIn: boolean; marketingOptIn: boolean; deletedAt: Date | null; active: boolean; adminRoleId: string | null };
export type TestUser = { id: string; email: string; name: string; password: string };

export type CreateUserOpts = {
  role?: "guest" | "member" | "admin"; name?: string; email?: string; password?: string; directoryOptIn?: boolean; organisation?: string; jobTitle?: string; locale?: string;
  /** Admin Portal role. Default: SUPER_ADMIN_ROLE_ID for role "admin", null otherwise. null = an admin with no role (no permissions). */
  adminRoleId?: string | null;
  /** Convenience: "Super Admin" or a role id (adminRoleId wins when both are given). */
  adminRole?: string;
  /** Default true. */
  active?: boolean;
};

/**
 * Insert a user directly (bcrypt cost 4: fast, and still verified by the app's bcrypt.compare). `role: "admin"` = Super Admin unless told otherwise.
 * createdAt is set 2 hours back: the app caps new accounts at 100 per hour across all visitors (rateLimit.ts, allowAccountCreation,
 * counted from User.createdAt), and the suite inserts well over 100 fixture users in one run. Fixture rows are not sign-ups, so
 * they stay out of that window; otherwise the sign-up and join specs would get "too many sign-up attempts" depending on test order.
 */
export async function createUser(opts: CreateUserOpts = {}): Promise<TestUser> {
  const id = e2eId(); const email = opts.email ?? uniqueEmail(); const name = opts.name ?? uniqueName(); const password = opts.password ?? uniquePassword();
  const role = opts.role ?? "guest";
  const fromName = opts.adminRole === undefined ? undefined : opts.adminRole === SUPER_ADMIN_NAME ? SUPER_ADMIN_ROLE_ID : opts.adminRole;
  const adminRoleId = opts.adminRoleId !== undefined ? opts.adminRoleId : fromName ?? (role === "admin" ? SUPER_ADMIN_ROLE_ID : null);
  await q(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, organisation, "jobTitle", country, province, locale, "directoryOptIn", "marketingOptIn", active, "adminRoleId", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,'United States','NY',$8,$9,false,$10,$11, now() - interval '2 hours')`,
    [id, email, name, bcrypt.hashSync(password, 4), role, opts.organisation ?? "E2E Testing Org", opts.jobTitle ?? null, opts.locale ?? "en", opts.directoryOptIn ?? false, opts.active ?? true, adminRoleId],
  );
  return { id, email, name, password };
}

/* ── admin roles (RBAC) ──────────────────────────────────────────────────────────── */

/** Permission JSON as stored in AdminRole.permissions. */
export type RolePermissions = Partial<Record<Module, readonly Action[]>>;
type AnyPermissions = RolePermissions | Record<string, readonly string[]>;
export type TestRole = { id: string; name: string };
export type TestAdmin = TestUser & { roleId: string; roleName: string };
export type RoleRow = { id: string; name: string; description: string | null; permissions: Record<string, string[]>; isSystem: boolean; createdAt: Date; updatedAt: Date };

const ALL: readonly Action[] = ["view", "create", "edit", "delete"];
/** Permission sets mirroring prisma/seed.ts. Create your own roles from them; don't rely on the seeded example roles. */
export const ROLE_PRESETS = {
  full: FULL_PERMISSIONS,
  memberManager: { members: ALL, events: ["view"], messages: ["view"] },
  eventManager: { members: ["view"], events: ALL, messages: ["view"] },
  viewer: { members: ["view"], events: ["view"], messages: ["view"] },
  eventsOnly: { events: ALL },
  none: {},
} as const satisfies Record<string, RolePermissions>;

/** Insert an Admin Portal role (id "e2e-…", name "E2E Role …" by default). The JSON is stored as given (not normalised). */
export async function createAdminRole(opts: { permissions: AnyPermissions; name?: string; description?: string }): Promise<TestRole> {
  const id = e2eId(); const name = opts.name ?? uniqueName("Role");
  await q(
    `INSERT INTO "AdminRole" (id, name, description, permissions, "isSystem", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4::jsonb,false,now(),now())`,
    [id, name, opts.description ?? null, JSON.stringify(opts.permissions)],
  );
  return { id, name };
}
/** Alias of createAdminRole. */
export const createRole = createAdminRole;

/** A role with `permissions` and an active admin user holding it. */
export async function createAdmin(
  permissions: AnyPermissions,
  opts: Omit<CreateUserOpts, "role" | "adminRoleId" | "adminRole"> & { roleName?: string; description?: string } = {},
): Promise<TestAdmin> {
  const { roleName, description, ...userOpts } = opts;
  const r = await createAdminRole({ permissions, name: roleName, description });
  const u = await createUser({ ...userOpts, role: "admin", adminRoleId: r.id });
  return { ...u, roleId: r.id, roleName: r.name };
}

export const roleById = (id: string) => one<RoleRow>(`SELECT * FROM "AdminRole" WHERE id = $1`, [id]);
export const roleByName = (name: string) => one<RoleRow>(`SELECT * FROM "AdminRole" WHERE name = $1`, [name]);
export const countUsersWithRole = (roleId: string) => count(`SELECT count(*) AS n FROM "User" WHERE "adminRoleId" = $1`, [roleId]);

/** DB-only state changes: no audit row, no sessionVersion bump (the app's own checks must do the work). */
export async function setActive(userId: string, active: boolean) { await q(`UPDATE "User" SET active = $2 WHERE id = $1`, [userId, active]); }
export async function setAdminRole(userId: string, roleId: string | null) { await q(`UPDATE "User" SET "adminRoleId" = $2 WHERE id = $1`, [userId, roleId]); }
export async function setRolePermissions(roleId: string, permissions: AnyPermissions) {
  await q(`UPDATE "AdminRole" SET permissions = $2::jsonb, "updatedAt" = now() WHERE id = $1`, [roleId, JSON.stringify(permissions)]);
}

/**
 * Deactivate every active Super Admin except `keepUserId`; returns a function that reactivates exactly those rows.
 * Always call it in `finally` (the seed admins' signed-in sessions depend on it).
 */
export async function deactivateOtherSuperAdmins(keepUserId: string): Promise<() => Promise<void>> {
  const rows = await q<{ id: string }>(
    `UPDATE "User" SET active = false WHERE role = 'admin' AND active AND "adminRoleId" = $1 AND id <> $2 RETURNING id`,
    [SUPER_ADMIN_ROLE_ID, keepUserId],
  );
  const ids = rows.map((r) => r.id);
  return async () => { if (ids.length) await q(`UPDATE "User" SET active = true WHERE id = ANY($1)`, [ids]); };
}

/** An open/closed membership row (no payment). Open statuses hold the activeSlot like the app does. */
export async function createMembership(userId: string, opts: { tierId?: string; status?: string; renewsAt?: Date } = {}): Promise<string> {
  const id = e2eId(); const status = opts.status ?? "active";
  const open = ["pending", "pending_verification", "active"].includes(status);
  const start = new Date(); const renews = opts.renewsAt ?? new Date(Date.now() + 300 * 864e5);
  await q(
    `INSERT INTO "Membership" (id, "userId", "tierId", status, "activeSlot", currency, "amountCents", "taxCents", "autoRenew", "startsAt", "renewsAt")
     VALUES ($1,$2,$3,$4,$5,'USD',0,0,false,$6,$7)`,
    [id, userId, opts.tierId ?? "professional", status, open ? userId : null, status === "active" ? start : null, status === "active" ? renews : null],
  );
  return id;
}

/** Active member (role member + active professional membership). */
export async function createMember(opts: CreateUserOpts = {}) {
  const u = await createUser({ ...opts, role: opts.role ?? "member" });
  const membershipId = await createMembership(u.id);
  return { ...u, membershipId };
}

export type EventRow = { id: string; slug: string; title: string; titleFr: string | null; summary: string; summaryFr: string | null; type: string; format: string; location: string | null; startsAt: Date; durationMin: number; cpe: number; memberPriceCents: number; publicPriceCents: number | null; published: boolean; cancelledAt: Date | null };

export async function createEvent(opts: Partial<Omit<EventRow, "id">> = {}): Promise<EventRow> {
  const id = e2eId(); const slug = opts.slug ?? uniqueSlug();
  const row = {
    title: opts.title ?? uniqueName("Event"), titleFr: opts.titleFr ?? null, summary: opts.summary ?? "An end-to-end test event.", summaryFr: opts.summaryFr ?? null,
    type: opts.type ?? "Webinar", format: opts.format ?? "Online", location: opts.location ?? null,
    startsAt: opts.startsAt ?? new Date(Date.now() + 60 * 864e5), durationMin: opts.durationMin ?? 60, cpe: opts.cpe ?? 1.5,
    memberPriceCents: opts.memberPriceCents ?? 0, publicPriceCents: opts.publicPriceCents === undefined ? 2500 : opts.publicPriceCents,
    published: opts.published ?? true, cancelledAt: opts.cancelledAt ?? null,
  };
  await q(
    `INSERT INTO "Event" (id, slug, title, "titleFr", summary, "summaryFr", type, format, location, "startsAt", "durationMin", cpe, "memberPriceCents", "publicPriceCents", published, "cancelledAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, slug, row.title, row.titleFr, row.summary, row.summaryFr, row.type, row.format, row.location, row.startsAt, row.durationMin, row.cpe, row.memberPriceCents, row.publicPriceCents, row.published, row.cancelledAt],
  );
  return { id, slug, ...row };
}

export async function createRegistration(userId: string, eventId: string, opts: { status?: string; ticket?: string; amountCents?: number } = {}): Promise<string> {
  const id = e2eId();
  await q(`INSERT INTO "Registration" (id, "userId", "eventId", ticket, status, "amountCents", currency) VALUES ($1,$2,$3,$4,$5,$6,'USD')`,
    [id, userId, eventId, opts.ticket ?? "member", opts.status ?? "confirmed", opts.amountCents ?? 0]);
  return id;
}

/* ── lookups ───────────────────────────────────────────────────────────────────── */

export const userByEmail = (email: string) => one<UserRow>(`SELECT * FROM "User" WHERE email = $1`, [email.toLowerCase()]);
export const userById = (id: string) => one<UserRow>(`SELECT * FROM "User" WHERE id = $1`, [id]);
export const membershipsOf = (userId: string) =>
  q<{ id: string; tierId: string; status: string; renewsAt: Date | null; activeSlot: string | null; rejectionReason: string | null }>(`SELECT * FROM "Membership" WHERE "userId" = $1 ORDER BY "createdAt" DESC`, [userId]);
export const eventById = (id: string) => one<EventRow>(`SELECT * FROM "Event" WHERE id = $1`, [id]);
export const eventByTitle = (title: string) => one<EventRow>(`SELECT * FROM "Event" WHERE title = $1`, [title]);
export const auditRows = (where: { action?: string; target?: string; actor?: string }) =>
  q<{ id: string; action: string; actor: string; target: string | null }>(
    `SELECT * FROM "AuditLog" WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR target = $2) AND ($3::text IS NULL OR actor = $3) ORDER BY "createdAt" DESC`,
    [where.action ?? null, where.target ?? null, where.actor ?? null],
  );

/** ET calendar day ("YYYY-MM-DD") of an instant, the way the app shows renewal days. */
export const etDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
