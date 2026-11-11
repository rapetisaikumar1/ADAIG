import { db } from "@/lib/db";
import { likeLiteral } from "@/lib/validation"; // Prisma turns insensitive equals/contains into ILIKE on Postgres: escape % and _
import type { Prisma } from "@/generated/prisma/client";
import { eventTimeZone, zoneDayStart } from "@/lib/time";
/**
 * Audit log viewer helpers (Admin → Audit log and /api/admin/audit.csv share the same filters).
 * Filters come from the query string: a = action prefix ("membership." or a full action), actor, target (free text: an id,
 * an email or part of a name), from / to (YYYY-MM-DD, whole days in event time, ET), p = page (1-based).
 */
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_CSV_MAX = 50_000;

export type AuditFilters = { a: string; actor: string; target: string; from: string; to: string; p: number };
type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

/** Strip control characters (Postgres rejects NUL), collapse spaces, cap the length. */
const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDay = (v: string) => { const m = DAY.exec(v); if (!m) return ""; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && +m[1] >= 2000 && +m[1] <= 2100 ? v : ""; };

export function parseAuditFilters(raw: Raw): AuditFilters {
  const get = (k: string) => { const v = raw instanceof URLSearchParams ? raw.get(k) : raw[k]; return Array.isArray(v) ? v[0] : v ?? ""; };
  const a = clean(get("a"), 80);
  const p = Math.min(Math.max(1, Math.floor(Number(get("p")) || 1)), 100_000);
  return { a: /^[a-z0-9_.-]+$/i.test(a) ? a : "", actor: clean(get("actor")), target: clean(get("target")), from: validDay(clean(get("from"), 10)), to: validDay(clean(get("to"), 10)), p };
}

/** Midnight (start of day) in ET for a YYYY-MM-DD day, plus `addDays`. DST-aware (src/lib/time.ts). */
export const etDayStart = (day: string, addDays = 0): Date => zoneDayStart(day, addDays, eventTimeZone);

/**
 * A timestamp as US Eastern wall time for CSV exports, e.g. "2027-07-01 09:00" (column names end in "ET"), so spreadsheets
 * match what every admin screen shows. The ISO/UTC columns are kept next to it for machine use.
 */
export function etCsvStamp(d: Date | null | undefined): string {
  if (!d) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: eventTimeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Users matching free text: exact email (case-insensitive), exact id, or name/email containing the text. Capped. */
async function usersMatching(q: string) {
  const rows = await db.user.findMany({
    where: { OR: [{ id: q }, { email: { equals: likeLiteral(q), mode: "insensitive" } }, ...(q.length >= 2 ? [{ name: { contains: likeLiteral(q), mode: "insensitive" as const } }, { email: { contains: likeLiteral(q), mode: "insensitive" as const } }] : [])] },
    select: { id: true }, take: 200,
  });
  return rows.map((r) => r.id);
}

export async function auditWhere(f: AuditFilters): Promise<Prisma.AuditLogWhereInput> {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.a) and.push({ action: { startsWith: f.a } });
  if (f.actor) {
    const ids = await usersMatching(f.actor);
    and.push({ OR: [{ actor: { equals: likeLiteral(f.actor), mode: "insensitive" } }, ...(ids.length ? [{ actor: { in: ids } }] : [])] });
  }
  if (f.target) {
    // A person's events also cover rows that target their memberships and registrations.
    const ids = await usersMatching(f.target);
    const [ms, rs] = ids.length ? await Promise.all([
      db.membership.findMany({ where: { userId: { in: ids } }, select: { id: true }, take: 1000 }),
      db.registration.findMany({ where: { userId: { in: ids } }, select: { id: true }, take: 1000 }),
    ]) : [[], []];
    const related = [...ids, ...ms.map((m) => m.id), ...rs.map((r) => r.id)];
    and.push({ OR: [{ target: { contains: likeLiteral(f.target), mode: "insensitive" } }, ...(related.length ? [{ target: { in: related } }] : [])] });
  }
  if (f.from) and.push({ createdAt: { gte: etDayStart(f.from) } });
  if (f.to) and.push({ createdAt: { lt: etDayStart(f.to, 1) } });
  return and.length ? { AND: and } : {};
}

/** "auth.login_failed" → admin.log.auth_login_failed; unknown codes fall back to a readable form of the code (as on the dashboard). */
export function auditLabel(t: { has: (k: string) => boolean; (k: string): string }, action: string) {
  const k = `log.${action.replace(/\./g, "_")}`;
  return t.has(k) ? t(k) : action.replace(/^[a-z]+\./, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export type RefKind = "user" | "deletedUser" | "membership" | "registration" | "event" | "message" | "role";
/** label = person/event name; kind is translated by the page (audit.kind_*); detail = untranslated extra (email, tier id, event title). */
export type Ref = { label: string; kind: RefKind; detail?: string; href?: string };
/**
 * Readable names for actor/target values (user, membership, registration, event, contact message, admin role ids, event slugs,
 * emails). People link to Admin → Users for admin accounts and to Admin → Members for everyone else (deleted: no link).
 * Values that are not ids (system, seed, cli, public, IP addresses, free text) map to nothing and are shown as-is.
 */
export async function resolveRefs(values: string[], locale: string): Promise<Map<string, Ref>> {
  const keys = [...new Set(values.filter(Boolean).map((v) => v.split(" ")[0]))].slice(0, 500);
  const out = new Map<string, Ref>();
  if (!keys.length) return out;
  const L = (p: string) => `/${locale}${p}`;
  const [users, byEmail, ms, rs, evs, msgs, roles] = await Promise.all([
    db.user.findMany({ where: { id: { in: keys } }, select: { id: true, name: true, email: true, role: true } }),
    db.user.findMany({ where: { email: { in: keys.filter((k) => k.includes("@")) } }, select: { id: true, name: true, email: true, role: true } }),
    db.membership.findMany({ where: { id: { in: keys } }, select: { id: true, tierId: true, user: { select: { id: true, name: true, role: true } } } }),
    db.registration.findMany({ where: { id: { in: keys } }, select: { id: true, user: { select: { id: true, name: true, role: true } }, event: { select: { id: true, title: true } } } }),
    db.event.findMany({ where: { OR: [{ id: { in: keys } }, { slug: { in: keys } }] }, select: { id: true, slug: true, title: true } }),
    db.contactMessage.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } }),
    db.adminRole.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } }),
  ]);
  const person = (u: { id: string; name: string; role: string }) =>
    u.role === "deleted" ? undefined : L(`/admin/${u.role === "admin" ? "users" : "members"}/${u.id}`);
  const name = (u: { name: string; role: string }) => (u.role === "deleted" ? "—" : u.name);
  for (const u of users) out.set(u.id, u.role === "deleted" ? { label: "—", kind: "deletedUser" } : { label: u.name, kind: "user", detail: u.email, href: person(u) });
  for (const u of byEmail) if (u.role !== "deleted") out.set(u.email, { label: u.name, kind: "user", detail: u.email, href: person(u) });
  for (const m of ms) out.set(m.id, { label: name(m.user), kind: "membership", detail: m.tierId, href: person(m.user) });
  for (const r of rs) out.set(r.id, { label: name(r.user), kind: "registration", detail: r.event.title, href: L(`/admin/events/${r.event.id}`) });
  for (const e of evs) { const ref: Ref = { label: e.title, kind: "event", href: L(`/admin/events/${e.id}`) }; out.set(e.id, ref); out.set(e.slug, ref); }
  for (const c of msgs) out.set(c.id, { label: c.name, kind: "message", href: L("/admin/messages?f=all") });
  for (const r of roles) out.set(r.id, { label: r.name, kind: "role", href: L(`/admin/roles/${r.id}`) });
  return out;
}
