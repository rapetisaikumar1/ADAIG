"use server";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { afterActivated } from "@/lib/membership";
import { cleanText, limits, safeLocale } from "@/lib/validation";
import { rejectedStudentPolicy } from "@/config/site";

/** Back to the members list, keeping the active filter tab (whitelisted) and adding an optional notice. */
function back(locale: string, fd: FormData, msg?: string): never {
  const f = String(fd.get("f") ?? ""); const p = new URLSearchParams();
  if (["pending", "active", "other"].includes(f)) p.set("f", f);
  if (msg) p.set("msg", msg);
  const s = p.toString();
  redirect(`/${locale}/admin/members${s ? `?${s}` : ""}`);
}
/**
 * Staff approve or reject a membership application (any tier; status "pending_verification"). Approving makes it active
 * for one year; for Student it also confirms eligibility. Applications carry no payment, so rejecting them never flags a refund
 * (only legacy paid rows with a paymentRef can be flagged).
 * BUG-034: each decision is ONE conditional update (WHERE status = 'pending_verification'); only the first decision wins,
 * later ones change nothing and get "already decided".
 */
export async function reviewEligibility(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const id = String(fd.get("id")); const decision = String(fd.get("decision"));
  const m = await db.membership.findUnique({ where: { id } }); if (!m) redirect(`/${locale}/admin/members`);
  let won = false;
  if (decision === "approve") {
    const now = new Date(); const renews = new Date(now); renews.setFullYear(now.getFullYear() + 1);
    won = (await db.membership.updateMany({ where: { id, status: "pending_verification" }, data: { status: "active", verifiedAt: now, verifiedBy: admin.id, startsAt: now, renewsAt: renews } })).count === 1;
    if (won) await afterActivated(m.userId, admin.id, "membership.eligibility_approved", id);
  } else if (decision === "reject") {
    const reason = cleanText(fd.get("reason"), limits.reason) || "Application not approved.";
    const flag = rejectedStudentPolicy() === "notice_manual_refund" && !!m.paymentRef;
    won = (await db.membership.updateMany({ where: { id, status: "pending_verification" }, data: { status: "rejected_verification", activeSlot: null, verifiedBy: admin.id, rejectionReason: reason, refundStatus: flag ? "refund_due" : null } })).count === 1;
    if (won) {
      await db.auditLog.create({ data: { actor: admin.id, action: "membership.eligibility_rejected", target: id } });
      if (flag) await db.auditLog.create({ data: { actor: admin.id, action: "payment.manual_refund_flagged", target: id } });
    }
    // Email notice: no mail provider is wired in the MVP; the member sees the notice + reason on their dashboard.
  }
  if (!won) { await db.auditLog.create({ data: { actor: admin.id, action: "membership.review_already_decided", target: id } }); back(locale, fd, "alreadyDecided"); }
  back(locale, fd, decision === "approve" ? "approved" : decision === "reject" ? "rejectedOk" : undefined);
}

/** Staff confirm they refunded a flagged payment by hand (e.g. in the Stripe test dashboard). */
export async function markRefunded(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const id = String(fd.get("id"));
  const m = await db.membership.findUnique({ where: { id } });
  if (m && (await db.membership.updateMany({ where: { id, refundStatus: "refund_due" }, data: { refundStatus: "refunded" } })).count) {
    await db.auditLog.create({ data: { actor: admin.id, action: "payment.manual_refund_done", target: id } });
  }
  back(locale, fd);
}

/** BUG-031: staff unlock an account locked by failed logins (clears its LoginThrottle rows). */
export async function unlockAccount(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const u = await db.user.findUnique({ where: { id: String(fd.get("id")) } });
  if (u) {
    const r = await db.loginThrottle.deleteMany({ where: { key: `e:${u.email}` } });
    await db.auditLog.create({ data: { actor: admin.id, action: "auth.account_unlocked", target: u.id + (r.count ? "" : " (no lock)") } });
  }
  back(locale, fd, "unlocked");
}

/** Promote/demote staff. Role is checked from the DB; the last admin can't be removed. */
export async function setRole(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const id = String(fd.get("id")); const makeAdmin = fd.get("role") === "admin";
  const target = await db.user.findUnique({ where: { id }, include: { memberships: { where: { status: "active" }, take: 1 } } });
  if (!target || target.role === "deleted") redirect(`/${locale}/admin/members`);
  if (makeAdmin) {
    await db.user.update({ where: { id }, data: { role: "admin" } });
  } else if (target.role === "admin") {
    const ok = await db.$transaction(async (tx) => {
      if ((await tx.user.count({ where: { role: "admin" } })) <= 1) return false;
      await tx.user.update({ where: { id }, data: { role: target.memberships.length ? "member" : "guest" } });
      return true;
    });
    if (!ok) { await db.auditLog.create({ data: { actor: admin.id, action: "admin.demote_blocked_last_admin", target: id } }); back(locale, fd, "lastAdmin"); }
  }
  await db.auditLog.create({ data: { actor: admin.id, action: makeAdmin ? "admin.role_promoted" : "admin.role_demoted", target: id } });
  back(locale, fd, "roleChanged");
}
