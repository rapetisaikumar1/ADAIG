/**
 * Direct database access for setup, assertions and cleanup (node-postgres, the driver the app itself uses).
 * Rows created here use the e2e markers (ids "e2e-…", emails "e2e+<run>-<n>@example.test", event slugs "e2e-…"),
 * so the global teardown (and `npm run test:e2e:cleanup`) can always find them.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { databaseUrl } from "./env";

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

export type UserRow = { id: string; email: string; name: string; role: string; passwordHash: string; sessionVersion: number; organisation: string | null; jobTitle: string | null; country: string; province: string | null; locale: string; directoryOptIn: boolean; marketingOptIn: boolean; deletedAt: Date | null };
export type TestUser = { id: string; email: string; name: string; password: string };

/** Insert a user directly (bcrypt cost 4: fast, and still verified by the app's bcrypt.compare). */
export async function createUser(opts: { role?: "guest" | "member" | "admin"; name?: string; email?: string; password?: string; directoryOptIn?: boolean; organisation?: string; jobTitle?: string; locale?: string } = {}): Promise<TestUser> {
  const id = e2eId(); const email = opts.email ?? uniqueEmail(); const name = opts.name ?? uniqueName(); const password = opts.password ?? uniquePassword();
  await q(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, organisation, "jobTitle", country, province, locale, "directoryOptIn", "marketingOptIn")
     VALUES ($1,$2,$3,$4,$5,$6,$7,'United States','NY',$8,$9,false)`,
    [id, email, name, bcrypt.hashSync(password, 4), opts.role ?? "guest", opts.organisation ?? "E2E Testing Org", opts.jobTitle ?? null, opts.locale ?? "en", opts.directoryOptIn ?? false],
  );
  return { id, email, name, password };
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
export async function createMember(opts: Parameters<typeof createUser>[0] = {}) {
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
