"use server";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { deletionPolicy } from "@/config/site";
export async function saveProfile(fd: FormData) {
  const locale = String(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  await db.user.update({ where: { id: s.user.id }, data: {
    name: String(fd.get("name") || "").trim() || undefined, organisation: String(fd.get("organisation") ?? ""), jobTitle: String(fd.get("jobTitle") ?? ""),
    locale: String(fd.get("prefLocale") ?? locale), directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on",
  } });
  await db.auditLog.create({ data: { actor: s.user.id, action: "profile.updated", target: s.user.id } });
  redirect(`/${locale}/my/profile?saved=1`);
}

/**
 * TC-E2E-006: member self-service account deletion.
 * Removed/anonymised: name, email, password, organisation, job title, province, preferences, CPE log, eligibility notes,
 * unpaid/free registrations, login-throttle rows, the email in audit-log targets.
 * Kept (anonymised, linked only to an opaque user id): memberships and paid registrations (amount, tax, currency, payment ref, dates)
 * for tax/financial record-keeping, and the audit log.
 */
export async function deleteAccount(fd: FormData) {
  const locale = String(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const u = await db.user.findUnique({ where: { id: s.user.id } });
  if (!u || u.role === "deleted") redirect(`/${locale}/login`);
  const ok = fd.get("confirm") === "on" && (await bcrypt.compare(String(fd.get("password") ?? ""), u.passwordHash));
  if (!ok) { await db.auditLog.create({ data: { actor: u.id, action: "account.delete_failed_confirmation", target: u.id } }); redirect(`/${locale}/my/profile?del=wrong`); }
  if (u.role === "admin" && (await db.user.count({ where: { role: "admin" } })) <= 1) redirect(`/${locale}/my/profile?del=lastAdmin`);
  const anonEmail = `deleted-${u.id}@deleted.invalid`;
  await db.$transaction([
    db.cpeEntry.deleteMany({ where: { userId: u.id } }),
    db.registration.deleteMany({ where: { userId: u.id, OR: [{ amountCents: 0 }, { status: { not: "confirmed" } }] } }),
    // Product decision pending (Bhanu): refunds for deleted paid memberships. Default "none" keeps current behaviour.
    ...(deletionPolicy().membershipRefund === "flag_manual_refund" ? [db.membership.updateMany({ where: { userId: u.id, status: { in: ["active", "pending_verification"] }, paymentRef: { not: null }, refundStatus: null }, data: { refundStatus: "refund_due" } })] : []),
    db.membership.updateMany({ where: { userId: u.id, status: { in: ["active", "pending", "pending_verification"] } }, data: { status: "cancelled", autoRenew: false, activeSlot: null } }),
    // Product decision pending (Bhanu): a deleted user's paid ticket. Default "keep" leaves the seat confirmed; "cancel" frees it (record kept).
    ...(deletionPolicy().paidTickets === "cancel" ? [db.registration.updateMany({ where: { userId: u.id, status: "confirmed", amountCents: { gt: 0 } }, data: { status: "cancelled" } })] : []),
    db.membership.updateMany({ where: { userId: u.id }, data: { eligibilityNote: null, rejectionReason: null } }),
    db.loginThrottle.deleteMany({ where: { key: `e:${u.email}` } }),
    db.auditLog.updateMany({ where: { target: u.email }, data: { target: `user:${u.id}` } }),
    db.user.update({ where: { id: u.id }, data: {
      email: anonEmail, name: "Deleted member", passwordHash: `!deleted:${randomBytes(16).toString("hex")}`, // not a bcrypt hash: can never match
      organisation: null, jobTitle: null, province: null, country: "—", directoryOptIn: false, marketingOptIn: false, role: "deleted", deletedAt: new Date(),
    } }),
    db.auditLog.create({ data: { actor: u.id, action: "account.deleted_by_member", target: u.id } }),
  ]);
  await signOut({ redirect: false });
  redirect(`/${locale}/login?deleted=1`);
}
