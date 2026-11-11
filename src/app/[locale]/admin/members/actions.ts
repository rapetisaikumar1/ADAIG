"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { afterActivated } from "@/lib/membership";
import { cleanText, limits, idParam } from "@/lib/validation";
import { rejectedStudentPolicy } from "@/lib/settings";
import { assertAdminPermission } from "@/lib/rbac";
import { memberQuery } from "./_shared";

/** List notices → account-page notices (adminMembers.msg_* / err_*). */
const DETAIL_MSG: Record<string, string> = { approved: "msg_approved", rejectedOk: "msg_rejected", alreadyDecided: "err_alreadyDecided", unlocked: "msg_unlocked", refundedOk: "msg_refunded" };

/**
 * Back to the members list, keeping the active filter tab (whitelisted) and adding an optional notice.
 * Forms on the account page (/admin/members/[id]) send ret=detail and go back there instead (userId comes from the DB).
 */
function back(locale: string, fd: FormData, msg?: string, userId?: string): never {
  if (fd.get("ret") === "detail" && userId) redirect(`/${locale}/admin/members/${encodeURIComponent(userId)}${msg ? `?msg=${DETAIL_MSG[msg] ?? "msg_saved"}` : "?msg=msg_saved"}#${msg === "unlocked" ? "account" : "memberships"}`);
  const f = String(fd.get("f") ?? ""); const p = new URLSearchParams();
  if (["pending", "active", "other"].includes(f)) p.set("f", f);
  const q = memberQuery(fd.get("q")); if (q) p.set("q", q); // keep the search, so the row stays in view
  const page = Math.floor(Number(fd.get("p")) || 1); if (page > 1 && page <= 100_000) p.set("p", String(page));
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
  const { locale, ctx } = await assertAdminPermission(fd, "members", "edit"); const admin = ctx.user;
  const id = idParam(fd.get("id")); const decision = String(fd.get("decision"));
  const m = await db.membership.findUnique({ where: { id }, include: { user: { select: { role: true } } } }); if (!m) redirect(`/${locale}/admin/members`);
  // D1 separation: an Admin Portal account's membership is not managed in Members (same answer as a missing account).
  if (m.user.role === "admin") back(locale, fd, "notFound");
  let won = false;
  if (decision === "approve") {
    const now = new Date(); const renews = new Date(now); renews.setFullYear(now.getFullYear() + 1);
    // One transaction: the status change, the guest → member role change and the audit row succeed or fail together.
    won = await db.$transaction(async (tx) => {
      const ok = (await tx.membership.updateMany({ where: { id, status: "pending_verification" }, data: { status: "active", verifiedAt: now, verifiedBy: admin.id, startsAt: now, renewsAt: renews } })).count === 1;
      if (ok) await afterActivated(m.userId, admin.id, "membership.eligibility_approved", id, tx);
      return ok;
    });
  } else if (decision === "reject") {
    // No reason typed → null: the member's dashboard then shows a translated "no reason given" (never English text stored in the DB).
    const reason = cleanText(fd.get("reason"), limits.reason) || null;
    const flag = (await rejectedStudentPolicy()) === "notice_manual_refund" && !!m.paymentRef;
    won = (await db.membership.updateMany({ where: { id, status: "pending_verification" }, data: { status: "rejected_verification", activeSlot: null, verifiedBy: admin.id, rejectionReason: reason, refundStatus: flag ? "refund_due" : null } })).count === 1;
    if (won) {
      await db.auditLog.create({ data: { actor: admin.id, action: "membership.eligibility_rejected", target: id } });
      if (flag) await db.auditLog.create({ data: { actor: admin.id, action: "payment.manual_refund_flagged", target: id } });
    }
    // Email notice: no mail provider is wired in the MVP; the member sees the notice + reason on their dashboard.
  }
  if (!won) { await db.auditLog.create({ data: { actor: admin.id, action: "membership.review_already_decided", target: id } }); back(locale, fd, "alreadyDecided", m.userId); }
  back(locale, fd, decision === "approve" ? "approved" : decision === "reject" ? "rejectedOk" : undefined, m.userId);
}

/** Staff confirm they refunded a flagged payment by hand (e.g. in the Stripe test dashboard). */
export async function markRefunded(fd: FormData) {
  const { locale, ctx } = await assertAdminPermission(fd, "members", "edit"); const admin = ctx.user;
  const id = idParam(fd.get("id"));
  const m = await db.membership.findUnique({ where: { id }, include: { user: { select: { role: true } } } });
  if (m?.user.role === "admin") back(locale, fd, "notFound"); // D1 separation
  const done = !!m && (await db.membership.updateMany({ where: { id, refundStatus: "refund_due" }, data: { refundStatus: "refunded" } })).count > 0;
  if (done) await db.auditLog.create({ data: { actor: admin.id, action: "payment.manual_refund_done", target: id } });
  back(locale, fd, done ? "refundedOk" : undefined, m?.userId);
}

/** BUG-031: staff unlock an account locked by failed logins (clears its LoginThrottle rows). */
export async function unlockAccount(fd: FormData) {
  const { locale, ctx } = await assertAdminPermission(fd, "members", "edit"); const admin = ctx.user;
  const u = await db.user.findUnique({ where: { id: idParam(fd.get("id")) } });
  // D1 separation: admin accounts are unlocked in Users (unlockAdminUser), never here.
  if (u?.role === "admin") back(locale, fd, "notFound");
  if (u) {
    const r = await db.loginThrottle.deleteMany({ where: { key: `e:${u.email}` } });
    await db.auditLog.create({ data: { actor: admin.id, action: "auth.account_unlocked", target: u.id + (r.count ? "" : " (no lock)") } });
  }
  back(locale, fd, "unlocked", u?.id);
}
