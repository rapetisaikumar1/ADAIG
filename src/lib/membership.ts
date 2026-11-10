import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getTier, defaultCurrency } from "@/config/site"; // tier ids (fixed in code)
import { getTier as getEffectiveTier, unpaidOrderTtlHours } from "@/lib/settings"; // admin-editable tier flags + TTL
import { wallTimeToInstant, zoneDay } from "@/lib/time";

/** The app's Prisma client or an interactive-transaction client (helpers below accept either). */
type Db = Prisma.TransactionClient;
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
  await db.$transaction(async (tx) => { // status, role and audit together (no active membership left without its role/audit row)
    const r = await tx.membership.updateMany({ where: { id, status: "pending" }, data: { status: "active", startsAt: now, renewsAt: renews } });
    if (r.count) await afterActivated(cur.userId, actor, "membership.activated", id, tx);
  });
  return db.membership.findUnique({ where: { id } });
}
/** Role + audit after a membership became active. Pass `tx` to run inside the caller's transaction. */
export async function afterActivated(userId: string, actor: string, action: string, id: string, tx: Db = db) {
  await tx.user.updateMany({ where: { id: userId, role: "guest" }, data: { role: "member" } });
  await tx.auditLog.create({ data: { actor, action, target: id } });
}
/** Event ticket payment succeeded (conditional, idempotent). */
export async function confirmRegistration(id: string, actor: string) {
  const r = await db.registration.updateMany({ where: { id, status: "pending_payment" }, data: { status: "confirmed" } });
  if (r.count) await db.auditLog.create({ data: { actor, action: "event.ticket_paid", target: id } });
  return db.registration.findUnique({ where: { id } });
}

/**
 * Membership housekeeping, lazily on access (scoped to a user: dashboard, join, admin member pages) and by the daily cron
 * (all users; also scripts/expire-unpaid-orders.mts). Conditional per row, so safe to run concurrently.
 * 1. BUG-042: unpaid orders (status "pending") older than UNPAID_ORDER_TTL_HOURS become "expired" and free the slot.
 *    Paid (active) and awaiting-verification orders are never touched.
 * 2. Active memberships more than LAPSE_GRACE_DAYS past their renewal date become "lapsed" (see lapseOverdue).
 */
export async function membershipHousekeeping(userId?: string): Promise<{ expired: number; lapsed: number }> {
  const expired = await expireUnpaidOrders(userId);
  const lapsed = await lapseOverdue(userId);
  return { expired, lapsed };
}
/** Same as membershipHousekeeping (kept for existing callers); returns the number of unpaid orders expired. */
export async function expireUnpaid(userId?: string) {
  return (await membershipHousekeeping(userId)).expired;
}

async function expireUnpaidOrders(userId?: string) {
  const cutoff = new Date(Date.now() - (await unpaidOrderTtlHours()) * 3600_000);
  const rows = await db.membership.findMany({ where: { status: "pending", createdAt: { lt: cutoff }, ...(userId ? { userId } : {}) }, select: { id: true } });
  let n = 0;
  for (const { id } of rows) {
    const r = await db.membership.updateMany({ where: { id, status: "pending", createdAt: { lt: cutoff } }, data: { status: "expired", activeSlot: null, autoRenew: false } });
    if (r.count) { n++; await db.auditLog.create({ data: { actor: "system", action: "membership.order_expired", target: id } }); }
  }
  return n;
}
/**
 * Grace period: an ACTIVE membership whose renewsAt is more than this many days in the past lapses automatically
 * (decision Nov 2026: no automatic renewals or reminders yet; staff contact members while the renewal is due).
 * scripts/expire-unpaid-orders.mts uses the same value.
 */
export const LAPSE_GRACE_DAYS = 30;
/** renewsAt before this instant → the membership is due to lapse. */
const lapseCutoff = (now = Date.now()) => new Date(now - LAPSE_GRACE_DAYS * 864e5);
/** An active membership past its renewal date but still in the grace period ("Renewal due — our team will contact you"). */
export const renewalDue = (m: { status: string; renewsAt: Date | null }, now = Date.now()) =>
  m.status === "active" && !!m.renewsAt && m.renewsAt.getTime() < now && m.renewsAt.getTime() >= lapseCutoff(now).getTime();

/**
 * Auto-lapse: active memberships with renewsAt older than LAPSE_GRACE_DAYS become "lapsed" (activeSlot cleared, autoRenew off),
 * the person goes back to guest unless another membership is active (admins keep their role), audit "membership.lapsed_auto"
 * (actor "system"). One conditional update per row inside a transaction, so concurrent runs lapse each membership once.
 * Returns the number lapsed. Staff can reactivate a lapsed membership in Admin → Members.
 */
async function lapseOverdue(userId?: string): Promise<number> {
  const cutoff = lapseCutoff();
  const rows = await db.membership.findMany({ where: { status: "active", renewsAt: { lt: cutoff }, ...(userId ? { userId } : {}) }, select: { id: true, userId: true } });
  let n = 0;
  for (const m of rows) {
    const done = await db.$transaction(async (tx) => {
      const r = await tx.membership.updateMany({ where: { id: m.id, status: "active", renewsAt: { lt: cutoff } }, data: { status: "lapsed", activeSlot: null, autoRenew: false } });
      if (!r.count) return false;
      await syncMemberRole(m.userId, tx);
      await tx.auditLog.create({ data: { actor: "system", action: "membership.lapsed_auto", target: m.id } });
      return true;
    });
    if (done) n++;
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
 *           rejected_verification | expired (unpaid order) | cancelled | lapsed (not renewed: set by staff, or automatically LAPSE_GRACE_DAYS after renewsAt) (CLOSED: activeSlot null).
 * Every change is ONE conditional update on the expected status, so a stale form or a second staff member changes nothing
 * (result "stale"). Re-opening a membership sets activeSlot again: the unique index refuses it when the person already has
 * another open membership (result "openExists"). Audit target = membership id (as for approve/reject).
 */
export const OPEN_STATUSES = ["pending", "pending_verification", "active"] as const;
export const REOPENABLE_STATUSES = ["lapsed", "cancelled", "expired"] as const;
export type StaffResult = "ok" | "stale" | "openExists" | "invalid";
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const oneYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d; };

/** A member whose last active membership ended goes back to guest (admins keep their role); same rule as removing admin access. */
export async function syncMemberRole(userId: string, tx: Db = db) {
  await tx.user.updateMany({ where: { id: userId, role: "member", memberships: { none: { status: "active" } } }, data: { role: "guest" } });
}

export async function staffChangeTier(id: string, tierId: string, actor: string): Promise<StaffResult> {
  if (!getTier(tierId)) return "invalid";
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  if (m.tierId === tierId) return "ok";
  // An eligibility note ("Attested student at: …") only applies to a tier that requires verification (F2-9).
  const keepNote = !!(await getEffectiveTier(tierId))?.requiresVerification;
  const r = await db.membership.updateMany({ where: { id, tierId: m.tierId, status: { in: [...OPEN_STATUSES] } }, data: { tierId, ...(keepNote ? {} : { eligibilityNote: null }) } });
  if (!r.count) return "stale";
  await db.auditLog.create({ data: { actor, action: "membership.tier_changed", target: id } });
  return "ok";
}

/** Cancel an open membership (active, under review or unpaid). No refund is made or flagged. */
export async function staffCancel(id: string, actor: string): Promise<StaffResult> {
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  return db.$transaction(async (tx) => {
    const r = await tx.membership.updateMany({ where: { id, status: { in: [...OPEN_STATUSES] } }, data: { status: "cancelled", activeSlot: null, autoRenew: false } });
    if (!r.count) return "stale" as const;
    await tx.auditLog.create({ data: { actor, action: "membership.cancelled_by_staff", target: id } });
    await syncMemberRole(m.userId, tx);
    return "ok" as const;
  });
}

/** An active membership that was not renewed: "lapsed" (ends the membership, frees the slot). */
export async function staffMarkLapsed(id: string, actor: string): Promise<StaffResult> {
  const m = await db.membership.findUnique({ where: { id } }); if (!m) return "stale";
  return db.$transaction(async (tx) => {
    const r = await tx.membership.updateMany({ where: { id, status: "active" }, data: { status: "lapsed", activeSlot: null, autoRenew: false } });
    if (!r.count) return "stale" as const;
    await tx.auditLog.create({ data: { actor, action: "membership.marked_lapsed", target: id } });
    await syncMemberRole(m.userId, tx);
    return "ok" as const;
  });
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
    return await db.$transaction(async (tx) => {
      const r = await tx.membership.updateMany({
        where: { id, status: { in: [...REOPENABLE_STATUSES] } },
        data: { status: "active", activeSlot: m.userId, autoRenew: false, startsAt: m.startsAt ?? now, renewsAt: renewsAt ?? oneYear(), verifiedAt: now, verifiedBy: actor },
      });
      if (!r.count) return "stale" as const;
      await afterActivated(m.userId, actor, "membership.reactivated", id, tx);
      return "ok" as const;
    });
  } catch (e) { if (isUnique(e)) return "openExists"; throw e; }
}

/** Staff add an active membership (e.g. a member who joined offline). Nothing is charged: amount 0, no payment ref. */
export async function staffGrant(userId: string, tierId: string, renewsAt: Date | null, actor: string): Promise<StaffResult> {
  if (!getTier(tierId)) return "invalid";
  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const { id } = await tx.membership.create({ data: {
        userId, activeSlot: userId, tierId, status: "active", currency: defaultCurrency, amountCents: 0, taxCents: 0, autoRenew: false,
        startsAt: now, renewsAt: renewsAt ?? oneYear(), verifiedAt: now, verifiedBy: actor,
      } });
      await afterActivated(userId, actor, "membership.granted_by_staff", id, tx);
    });
  } catch (e) { if (isUnique(e)) return "openExists"; throw e; }
  return "ok";
}

/**
 * A renewal date typed by staff (date input "YYYY-MM-DD", a day in ET) → noon ET that day, so it shows as that day everywhere.
 * Must be a real day, after today and at most 10 years ahead; otherwise null.
 */
export function parseRenewalDay(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim()); if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  if (new Date(wall).getUTCDate() !== +m[3] || new Date(wall).getUTCMonth() !== +m[2] - 1) return null;
  const t = wallTimeToInstant(wall);
  const max = new Date(); max.setFullYear(max.getFullYear() + 10);
  return t > Date.now() && t <= +max ? new Date(t) : null;
}
/** "YYYY-MM-DD" of an instant in ET (for date inputs). */
export const renewalDayValue = (d: Date) => zoneDay(d);
