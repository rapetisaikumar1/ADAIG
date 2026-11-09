import { db } from "@/lib/db";
import { getTier, unpaidOrderTtlHours } from "@/config/site";
/**
 * Called once payment succeeds (mock, Stripe return page or webhook, possibly concurrently).
 * The status change is a conditional update (WHERE status = 'pending'), so only one caller wins (BUG-038).
 * Tiers that require eligibility checks go to pending_verification instead of active.
 */
export async function activateMembership(id: string, actor: string) {
  const cur = await db.membership.findUnique({ where: { id } });
  if (!cur) return null;
  if (getTier(cur.tierId)?.requiresVerification) {
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
  const cutoff = new Date(Date.now() - unpaidOrderTtlHours() * 3600_000);
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
