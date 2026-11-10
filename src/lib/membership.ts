import { db } from "@/lib/db";
import { getTier, defaultCurrency } from "@/config/site"; // tier ids (fixed in code)
import { getTier as getEffectiveTier, unpaidOrderTtlHours } from "@/lib/settings"; // admin-editable tier flags + TTL
/**
 * Called once payment succeeds (mock, Stripe return page or webhook, possibly concurrently).
 * The status change is a conditional update (WHERE status = 'pending'), so only one caller wins (BUG-038).
 * Tiers that require eligibility checks go to pending_verification instead of active.
 */
export async function activateMembership(id: string, actor: string) {
  const cur = await db.membership.findUnique({ where: { id } });
  if (!cur) return null;
  if ((await getEffectiveTier(cur.tierId))?.requiresVerification) {
    const r = await db.membership.updateMany({ where: { id, status: "pending" }, data: { status: "pending_verification" } });
    if (r.count) await db.auditLog.create({ data: { actor, action: "membership.paid_pending_verification", target: id } });
    return db.membership.findUnique({ where: { id } });
  }
  if (cur.status === "cancelled" || cur.status === "expired") { // paid after the order was cancelled/expired → flag for manual refund, never reactivate
    const r = await db.membership.updateMany({ where: { id, status: cur.status, refundStatus: null }, data: { refundStatus: "refund_due" } });
    if (r.count) await db.auditLog.create({ data: { actor, action: "payment.received_for_closed_order", target: id } });
    return db.membership.findUnique({ where: { id } });
  }
  const now = new Date(); const renews = new Date(now); renews.setFullYear(now.getFullYear() + 1);
  const r = await db.membership.updateMany({ where: { id, status: "pending" }, data: { status: "active", startsAt: now, renewsAt: renews } });
  if (r.count) await afterActivated(cur.userId, actor, "membership.activated", id);
  return db.membership.findUnique({ where: { id } });
}
/** Role + audit after a membership became active. */
export async function afterActivated(userId: string, actor: string, action: string, id: string) {
  await db.user.updateMany({ where: { id: userId, role: "guest" }, data: { role: "member" } });
  await db.auditLog.create({ data: { actor, action, target: id } });
}
/** Event ticket payment succeeded (conditional, idempotent). */
export async function confirmRegistration(id: string, actor: string) {
  const r = await db.registration.updateMany({ where: { id, status: "pending_payment" }, data: { status: "confirmed" } });
  if (r.count) await db.auditLog.create({ data: { actor, action: "event.ticket_paid", target: id } });
  return db.registration.findUnique({ where: { id } });
}

/**
 * BUG-042: unpaid orders (status "pending") older than UNPAID_ORDER_TTL_HOURS become "expired" and free the slot.
 * Paid (active) and awaiting-verification orders are never touched. Called lazily on access (scoped to a user)
 * and by scripts/expire-unpaid-orders.mjs (all users). Conditional per row, so safe to run concurrently.
 */
export async function expireUnpaid(userId?: string) {
  const cutoff = new Date(Date.now() - (await unpaidOrderTtlHours()) * 3600_000);
  const rows = await db.membership.findMany({ where: { status: "pending", createdAt: { lt: cutoff }, ...(userId ? { userId } : {}) }, select: { id: true } });
  let n = 0;
  for (const { id } of rows) {
    const r = await db.membership.updateMany({ where: { id, status: "pending", createdAt: { lt: cutoff } }, data: { status: "expired", activeSlot: null, autoRenew: false } });
    if (r.count) { n++; await db.auditLog.create({ data: { actor: "system", action: "membership.order_expired", target: id } }); }
  }
  return n;
}
/** Cancel one of the user's own unpaid orders. Returns true if it was cancelled by this call. */
export async function cancelUnpaid(id: string, userId: string, action = "membership.order_cancelled") {
  const r = await db.membership.updateMany({ where: { id, userId, status: "pending" }, data: { status: "cancelled", activeSlot: null, autoRenew: false } });
  if (r.count) await db.auditLog.create({ data: { actor: userId, action, target: id } });
  return r.count === 1;
}

/* ───────────── Staff membership management (Admin → Members → account page) ─────────────
 * Statuses: pending | pending_verification | active (OPEN: hold activeSlot = userId, at most one per person, BUG-033)
 *           rejected_verification | expired (unpaid order) | cancelled | lapsed (staff: membership not renewed) (CLOSED: activeSlot null).
 * Every change is ONE conditional update on the expected status, so a stale form or a second staff member changes nothing
 * (result "stale"). Re-opening a membership sets activeSlot again: the unique index refuses it when the person already has
 * another open membership (result "openExists"). Audit target = membership id (as for approve/reject).
 */
export const OPEN_STATUSES = ["pending", "pending_verification", "active"] as const;
export const REOPENABLE_STATUSES = ["lapsed", "cancelled", "expired"] as const;
export type StaffResult = "ok" | "stale" | "openExists" | "invalid";
const RENEWAL_ZONE = "America/New_York"; // = eventTimeZone (ADAIG operating time zone, ET)
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const oneYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d; };

/** A member whose last active membership ended goes back to guest (admins keep their role); same rule as removing admin access. */
export async function syncMemberRole(userId: string) {
  await db.user.updateMany({ where: { id: userId, role: "member", memberships: { none: { status: "active" } } }, data: { role: "guest" } });
}

export async function staffChangeTier(id: string, tierId: string, actor: string): Promise<StaffResult> {
  if (!getTier(tierId)) return "invalid";
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  if (m.tierId === tierId) return "ok";
  const r = await db.membership.updateMany({ where: { id, tierId: m.tierId, status: { in: [...OPEN_STATUSES] } }, data: { tierId } });
  if (!r.count) return "stale";
  await db.auditLog.create({ data: { actor, action: "membership.tier_changed", target: id } });
  return "ok";
}

/** Cancel an open membership (active, under review or unpaid). No refund is made or flagged. */
export async function staffCancel(id: string, actor: string): Promise<StaffResult> {
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  const r = await db.membership.updateMany({ where: { id, status: { in: [...OPEN_STATUSES] } }, data: { status: "cancelled", activeSlot: null, autoRenew: false } });
  if (!r.count) return "stale";
  await db.auditLog.create({ data: { actor, action: "membership.cancelled_by_staff", target: id } });
  await syncMemberRole(m.userId);
  return "ok";
}

/** An active membership that was not renewed: "lapsed" (ends the membership, frees the slot). */
export async function staffMarkLapsed(id: string, actor: string): Promise<StaffResult> {
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  const r = await db.membership.updateMany({ where: { id, status: "active" }, data: { status: "lapsed", activeSlot: null, autoRenew: false } });
  if (!r.count) return "stale";
  await db.auditLog.create({ data: { actor, action: "membership.marked_lapsed", target: id } });
  await syncMemberRole(m.userId);
  return "ok";
}

/** Set or extend the renewal date of an active membership. */
export async function staffSetRenewal(id: string, renewsAt: Date, actor: string): Promise<StaffResult> {
  const r = await db.membership.updateMany({ where: { id, status: "active" }, data: { renewsAt } });
  if (!r.count) return "stale";
  await db.auditLog.create({ data: { actor, action: "membership.renewal_changed", target: id } });
  return "ok";
}

/** Reactivate a lapsed / cancelled / expired membership (renews on `renewsAt`, default one year from now). */
export async function staffReactivate(id: string, renewsAt: Date | null, actor: string): Promise<StaffResult> {
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  const now = new Date();
  try {
    const r = await db.membership.updateMany({
      where: { id, status: { in: [...REOPENABLE_STATUSES] } },
      data: { status: "active", activeSlot: m.userId, autoRenew: false, startsAt: m.startsAt ?? now, renewsAt: renewsAt ?? oneYear(), verifiedAt: now, verifiedBy: actor },
    });
    if (!r.count) return "stale";
  } catch (e) { if (isUnique(e)) return "openExists"; throw e; }
  await afterActivated(m.userId, actor, "membership.reactivated", id);
  return "ok";
}

/** Staff add an active membership (e.g. a member who joined offline). Nothing is charged: amount 0, no payment ref. */
export async function staffGrant(userId: string, tierId: string, renewsAt: Date | null, actor: string): Promise<StaffResult> {
  if (!getTier(tierId)) return "invalid";
  const now = new Date();
  let id: string;
  try {
    id = (await db.membership.create({ data: {
      userId, activeSlot: userId, tierId, status: "active", currency: defaultCurrency, amountCents: 0, taxCents: 0, autoRenew: false,
      startsAt: now, renewsAt: renewsAt ?? oneYear(), verifiedAt: now, verifiedBy: actor,
    } })).id;
  } catch (e) { if (isUnique(e)) return "openExists"; throw e; }
  await afterActivated(userId, actor, "membership.granted_by_staff", id);
  return "ok";
}

/** Milliseconds the zone is ahead of UTC at instant t. */
function zoneOffset(t: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}
/**
 * A renewal date typed by staff (date input "YYYY-MM-DD", a day in ET) → noon ET that day, so it shows as that day everywhere.
 * Must be a real day, after today and at most 10 years ahead; otherwise null.
 */
export function parseRenewalDay(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim()); if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  if (new Date(wall).getUTCDate() !== +m[3] || new Date(wall).getUTCMonth() !== +m[2] - 1) return null;
  let t = wall - zoneOffset(wall, RENEWAL_ZONE); t = wall - zoneOffset(t, RENEWAL_ZONE);
  const max = new Date(); max.setFullYear(max.getFullYear() + 10);
  return t > Date.now() && t <= +max ? new Date(t) : null;
}
/** "YYYY-MM-DD" of an instant in ET (for date inputs). */
export const renewalDayValue = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: RENEWAL_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
