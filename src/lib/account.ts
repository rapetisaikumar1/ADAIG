import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { deletionPolicy } from "@/lib/settings";

/** Lock every admin row (stable order) so last-admin checks can't race each other. */
const lockAdmins = (tx: Prisma.TransactionClient) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE role = 'admin' ORDER BY id FOR UPDATE`;

export type DeleteAccountResult = "deleted" | "lastAdmin" | "notFound";

/**
 * TC-E2E-006: account deletion, shared by member self-service (Profile → Delete my account) and staff (Admin → Members → account).
 * Removed/anonymised: name, email, password, organisation, job title, province, preferences, CPE log, eligibility notes,
 * unpaid/free registrations, login-throttle rows, contact messages, the email in audit-log targets.
 * Kept (anonymised, linked only to an opaque user id): memberships and paid registrations (amount, tax, currency, payment ref, dates)
 * for tax/financial record-keeping, and the audit log. Open memberships are cancelled (no refund unless DELETED_MEMBERSHIP_REFUND says so).
 *
 * The last admin can never be deleted: admin rows are locked (SELECT … FOR UPDATE) inside the transaction, so two concurrent
 * deletions/demotions of the last two admins can't both succeed. Callers do their own checks (password, confirmation) first and
 * sign the member out afterwards when it is a self-deletion. `action` is the audit action written with `actor`.
 */
export async function deleteUserAccount(userId: string, audit: { actor: string; action: string }): Promise<DeleteAccountResult> {
  const policy = await deletionPolicy(); // Admin → Settings, else env, else default
  return db.$transaction(async (tx) => {
    const first = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!first || first.role === "deleted") return "notFound";
    // Lock order everywhere: admin rows (by id), then the user's row. Re-read after locking (READ COMMITTED sees the latest commit).
    const admins = first.role === "admin" ? await lockAdmins(tx) : [];
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u || u.role === "deleted") return "notFound";
    if (u.role === "admin" && admins.filter((a) => a.id !== u.id).length === 0) return "lastAdmin";
    const anonEmail = `deleted-${u.id}@deleted.invalid`;
    await tx.cpeEntry.deleteMany({ where: { userId: u.id } });
    await tx.registration.deleteMany({ where: { userId: u.id, OR: [{ amountCents: 0 }, { status: { not: "confirmed" } }] } });
    // Product decision pending (Bhanu): refunds for deleted paid memberships. Default "none" keeps current behaviour.
    if (policy.membershipRefund === "flag_manual_refund") await tx.membership.updateMany({ where: { userId: u.id, status: { in: ["active", "pending_verification"] }, paymentRef: { not: null }, refundStatus: null }, data: { refundStatus: "refund_due" } });
    await tx.membership.updateMany({ where: { userId: u.id, status: { in: ["active", "pending", "pending_verification"] } }, data: { status: "cancelled", autoRenew: false, activeSlot: null } });
    // Product decision pending (Bhanu): a deleted user's paid ticket. Default "keep" leaves the seat confirmed; "cancel" frees it (record kept).
    if (policy.paidTickets === "cancel") await tx.registration.updateMany({ where: { userId: u.id, status: "confirmed", amountCents: { gt: 0 } }, data: { status: "cancelled" } });
    await tx.membership.updateMany({ where: { userId: u.id }, data: { eligibilityNote: null, rejectionReason: null } });
    await tx.loginThrottle.deleteMany({ where: { key: `e:${u.email}` } });
    await tx.contactMessage.deleteMany({ where: { OR: [{ userId: u.id }, { email: u.email }] } });
    await tx.auditLog.updateMany({ where: { target: u.email }, data: { target: `user:${u.id}` } });
    await tx.user.update({ where: { id: u.id }, data: {
      email: anonEmail, name: "Deleted member", passwordHash: `!deleted:${randomBytes(16).toString("hex")}`, // not a bcrypt hash: can never match
      organisation: null, jobTitle: null, province: null, country: "—", directoryOptIn: false, marketingOptIn: false, role: "deleted", deletedAt: new Date(),
    } });
    await tx.auditLog.create({ data: { actor: audit.actor, action: audit.action, target: u.id } });
    return "deleted";
  }, { timeout: 15_000 });
}

/** Last-admin-safe role change (admin rows locked in the transaction). "lastAdmin" when it would remove the last admin. */
export async function changeRole(userId: string, role: "guest" | "member" | "admin"): Promise<"changed" | "unchanged" | "lastAdmin" | "notFound"> {
  return db.$transaction(async (tx) => {
    const admins = await lockAdmins(tx);
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u || u.role === "deleted") return "notFound";
    if (u.role === role) return "unchanged";
    if (u.role === "admin" && admins.filter((a) => a.id !== u.id).length === 0) return "lastAdmin";
    await tx.user.update({ where: { id: userId }, data: { role } });
    return "changed";
  });
}
