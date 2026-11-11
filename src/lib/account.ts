import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { deletionPolicy } from "@/lib/settings";
import { SUPER_ADMIN_ROLE_ID } from "@/lib/permissions";

/**
 * Lock every ACTIVE Super Admin row (stable order) so last-Super-Admin checks can't race (SPEC_R7 §3.4 rule 2).
 * Lock order everywhere: these rows, then the target row.
 */
export const lockActiveSuperAdmins = (tx: Prisma.TransactionClient) => tx.$queryRaw<{ id: string }[]>`
  SELECT id FROM "User" WHERE role = 'admin' AND active AND "adminRoleId" = ${SUPER_ADMIN_ROLE_ID} ORDER BY id FOR UPDATE`;
const isActiveSuper = (u: { role: string; active: boolean; adminRoleId: string | null }) => u.role === "admin" && u.active && u.adminRoleId === SUPER_ADMIN_ROLE_ID;

export type DeleteAccountResult = "deleted" | "lastAdmin" | "notFound";

/**
 * TC-E2E-006: account deletion, shared by member self-service (Profile → Delete my account) and staff (Admin → Members → account).
 * Removed/anonymised: name, email, password, organisation, job title, province, preferences, CPE log, eligibility notes,
 * unpaid/free registrations, login-throttle rows, contact messages, the email in audit-log targets.
 * Kept (anonymised, linked only to an opaque user id): memberships and paid registrations (amount, tax, currency, payment ref, dates)
 * for tax/financial record-keeping, and the audit log. Open memberships are cancelled (no refund unless DELETED_MEMBERSHIP_REFUND says so).
 *
 * The last active Super Admin can never be deleted: active Super Admin rows are locked (SELECT … FOR UPDATE) inside the
 * transaction, so two concurrent deletions/demotions/deactivations of the last two can't both succeed. Callers do their own checks (password, confirmation) first and
 * sign the member out afterwards when it is a self-deletion. `action` is the audit action written with `actor`.
 */
export async function deleteUserAccount(userId: string, audit: { actor: string; action: string }): Promise<DeleteAccountResult> {
  const policy = await deletionPolicy(); // Admin → Settings, else env, else default
  return db.$transaction(async (tx) => {
    const first = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!first || first.role === "deleted") return "notFound";
    // Lock order everywhere: active Super Admin rows (by id), then the user's row. Re-read after locking (READ COMMITTED sees the latest commit).
    const supers = first.role === "admin" ? await lockActiveSuperAdmins(tx) : [];
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u || u.role === "deleted") return "notFound";
    if (isActiveSuper(u) && supers.filter((a) => a.id !== u.id).length === 0) return "lastAdmin";
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
      adminRoleId: null, // an anonymised account never blocks a role deletion (FK RESTRICT)
    } });
    await tx.auditLog.create({ data: { actor: audit.actor, action: audit.action, target: u.id } });
    return "deleted";
  }, { timeout: 15_000 });
}

/**
 * Members-side guest ↔ member role sync. Admin accounts are managed only in Admin → Users (D1): an admin target is "notFound".
 */
export async function changeRole(userId: string, role: "guest" | "member"): Promise<"changed" | "unchanged" | "notFound"> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u || u.role === "deleted" || u.role === "admin") return "notFound";
    if (u.role === role) return "unchanged";
    await tx.user.update({ where: { id: userId }, data: { role } });
    return "changed";
  });
}

/** "conflict": the target's role changed since the caller's permission check (only when `expectedAdminRoleId` is passed). */
export type AdminChange = "changed" | "unchanged" | "lastSuperAdmin" | "notFound" | "badRole" | "conflict";
/**
 * Expected state of the target, read by the caller before its canManageUser check. When `expectedAdminRoleId` is given
 * (null = "no role"), the helper re-reads the locked row and returns "conflict" if the role is different, so a check made on
 * stale data (target promoted concurrently) can't pass.
 */
export type AdminExpect = { expectedAdminRoleId?: string | null };
const roleMoved = (u: { adminRoleId: string | null }, expect?: AdminExpect) =>
  expect?.expectedAdminRoleId !== undefined && u.adminRoleId !== expect.expectedAdminRoleId;

/**
 * Admin → Users: give an admin account another Admin Portal role (last-Super-Admin safe). A real change bumps sessionVersion
 * (D4: the user signs in again). Locks: active Super Admins, then the target. Callers check permissions first (not self,
 * canManageUser, canAssignRole).
 */
export async function setAdminRole(targetId: string, roleId: string, expect?: AdminExpect): Promise<AdminChange> {
  return db.$transaction(async (tx) => {
    const supers = await lockActiveSuperAdmins(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: targetId } });
    if (!u || u.role !== "admin") return "notFound";
    if (roleMoved(u, expect)) return "conflict";
    const role = await tx.adminRole.findUnique({ where: { id: roleId }, select: { id: true } });
    if (!role) return "badRole";
    if (u.adminRoleId === role.id) return "unchanged";
    if (isActiveSuper(u) && role.id !== SUPER_ADMIN_ROLE_ID && supers.filter((x) => x.id !== u.id).length === 0) return "lastSuperAdmin";
    await tx.user.update({ where: { id: u.id }, data: { adminRoleId: role.id, sessionVersion: { increment: 1 } } });
    return "changed";
  });
}

/**
 * Admin → Users: activate or deactivate an admin account (last-Super-Admin safe). Deactivation bumps sessionVersion (D4/D5; the
 * session callback also rejects inactive users); reactivation doesn't. Same locking as setAdminRole.
 */
export async function setAdminActive(targetId: string, active: boolean, expect?: AdminExpect): Promise<AdminChange> {
  return db.$transaction(async (tx) => {
    const supers = await lockActiveSuperAdmins(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: targetId } });
    if (!u || u.role !== "admin") return "notFound";
    if (roleMoved(u, expect)) return "conflict";
    if (u.active === active) return "unchanged";
    if (!active && isActiveSuper(u) && supers.filter((x) => x.id !== u.id).length === 0) return "lastSuperAdmin";
    await tx.user.update({ where: { id: u.id }, data: active ? { active: true } : { active: false, sessionVersion: { increment: 1 } } });
    return "changed";
  });
}
