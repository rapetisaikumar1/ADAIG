"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { cleanText, safeLocale, checkPassword, isUniqueViolation, idParam } from "@/lib/validation";
import { deleteUserAccount, changeRole } from "@/lib/account";
import { staffChangeTier, staffCancel, staffMarkLapsed, staffSetRenewal, staffReactivate, staffGrant, parseRenewalDay, type StaffResult } from "@/lib/membership";
import { parseProfile, tempPassword } from "../_validate";

/**
 * Admin → Members → account page. Every action re-checks the admin role from the DB (currentAdmin), validates its input,
 * writes an AuditLog entry and redirects back to the account page with a notice (?msg=<adminMembers.msg_* key>).
 */
async function guard(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  return { locale, admin };
}
/** Back to the account page. The id always comes from the DB, never straight from the form. */
function back(locale: string, userId: string, msg: string, anchor = ""): never {
  redirect(`/${locale}/admin/members/${encodeURIComponent(userId)}?msg=${msg}${anchor ? `#${anchor}` : ""}`);
}
/** Target user from the form's uid (must exist and not be deleted), else back to the list. */
async function targetUser(fd: FormData, locale: string) {
  const u = await db.user.findUnique({ where: { id: idParam(fd.get("uid")) } });
  if (!u || u.role === "deleted") redirect(`/${locale}/admin/members?msg=notFound`);
  return u;
}

/* ── profile ── */
export async function updateProfile(fd: FormData) {
  const { locale, admin } = await guard(fd); const u = await targetUser(fd, locale);
  const r = parseProfile(fd); if ("error" in r) back(locale, u.id, r.error, "profile");
  const d = r.data; const emailChanged = d.email !== u.email;
  if (emailChanged && (await db.user.findUnique({ where: { email: d.email } }))) back(locale, u.id, "err_emailTaken", "profile");
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: d });
      if (emailChanged) { // login lockouts are keyed by email: move the counter to the new address
        await tx.loginThrottle.deleteMany({ where: { key: `e:${d.email}` } });
        await tx.loginThrottle.updateMany({ where: { key: `e:${u.email}` }, data: { key: `e:${d.email}` } });
      }
      await tx.auditLog.create({ data: { actor: admin.id, action: "admin.profile_updated", target: u.id } });
      if (emailChanged) await tx.auditLog.create({ data: { actor: admin.id, action: "admin.email_changed", target: u.id } });
    });
  } catch (e) { if (isUniqueViolation(e)) back(locale, u.id, "err_emailTaken", "profile"); throw e; }
  back(locale, u.id, "msg_profileSaved", "profile");
}

/* ── account: role, password ── */
const ROLES = ["guest", "member", "admin"] as const;
/**
 * Staff grant or remove admin access. Guest/member is not chosen by hand: it follows the memberships (an active membership →
 * member, none → guest), so the only non-admin role accepted is the one the memberships give.
 */
export async function setUserRole(fd: FormData) {
  const { locale, admin } = await guard(fd); const u = await targetUser(fd, locale);
  const role = String(fd.get("role")); if (!(ROLES as readonly string[]).includes(role)) back(locale, u.id, "err_invalid", "account");
  if (u.id === admin.id) back(locale, u.id, "err_selfRole", "account");
  if (role !== "admin") {
    const derived = (await db.membership.count({ where: { userId: u.id, status: "active" } })) ? "member" : "guest";
    if (role !== derived) back(locale, u.id, derived === "member" ? "err_roleHasMembership" : "err_roleNeedsMembership", "account");
  }
  const r = await changeRole(u.id, role as (typeof ROLES)[number]);
  if (r === "lastAdmin") { await db.auditLog.create({ data: { actor: admin.id, action: "admin.demote_blocked_last_admin", target: u.id } }); back(locale, u.id, "err_lastAdmin", "account"); }
  if (r === "changed") await db.auditLog.create({ data: { actor: admin.id, action: role === "admin" ? "admin.role_promoted" : u.role === "admin" ? "admin.role_demoted" : "admin.role_changed", target: u.id } });
  back(locale, u.id, r === "changed" ? "msg_roleChanged" : "msg_noChange", "account");
}

export type PasswordState = { password?: string; error?: string };
/**
 * Staff set a temporary password: typed by staff or generated. Checked with checkPassword(); returned ONCE to this response
 * (never stored in plain text, never in the URL or the audit log). The account's existing sessions are ended: sessionVersion
 * is incremented, and the session callback in src/auth.ts rejects tokens issued with an older version.
 */
export async function resetPassword(_: PasswordState, fd: FormData): Promise<PasswordState> {
  const { locale, admin } = await guard(fd);
  const t = await getTranslations({ locale, namespace: "adminMembers" });
  const u = await db.user.findUnique({ where: { id: idParam(fd.get("uid")) } });
  if (!u || u.role === "deleted") return { error: t("err_notFound") };
  const typed = String(fd.get("password") ?? "");
  const password = typed ? typed : tempPassword();
  const pwErr = checkPassword(password, u.email); if (pwErr) return { error: t(`err_pw_${pwErr}`) };
  const hash = await bcrypt.hash(password, 10);
  const r = await db.user.updateMany({ where: { id: u.id, role: { not: "deleted" } }, data: { passwordHash: hash, sessionVersion: { increment: 1 } } });
  if (!r.count) return { error: t("err_notFound") };
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.password_reset", target: u.id } });
  return { password };
}

/* ── delete / anonymize (same logic as Profile → Delete my account) ── */
export async function deleteUser(fd: FormData) {
  const { locale, admin } = await guard(fd); const u = await targetUser(fd, locale);
  if (fd.get("confirm") !== "on") back(locale, u.id, "err_confirmDelete", "delete");
  if (u.id === admin.id) back(locale, u.id, "err_selfDelete", "delete");
  const r = await deleteUserAccount(u.id, { actor: admin.id, action: "account.deleted_by_admin" });
  if (r === "lastAdmin") { await db.auditLog.create({ data: { actor: admin.id, action: "admin.delete_blocked_last_admin", target: u.id } }); back(locale, u.id, "err_lastAdmin", "delete"); }
  redirect(`/${locale}/admin/members?msg=accountDeleted`);
}

/* ── memberships ── */
const STAFF_MSG: Record<StaffResult, string> = { ok: "msg_membershipSaved", stale: "err_stale", openExists: "err_openExists", invalid: "err_invalid" };
async function membershipOf(fd: FormData, locale: string) {
  const m = await db.membership.findUnique({ where: { id: idParam(fd.get("id")) }, include: { user: { select: { role: true } } } });
  if (!m) redirect(`/${locale}/admin/members?msg=notFound`);
  if (m.user.role === "deleted") back(locale, m.userId, "err_deleted", "memberships");
  return m;
}
export async function membershipAction(fd: FormData) {
  const { locale, admin } = await guard(fd); const m = await membershipOf(fd, locale);
  const op = String(fd.get("op"));
  let r: StaffResult = "invalid";
  if (op === "tier") r = await staffChangeTier(m.id, String(fd.get("tier") ?? ""), admin.id);
  else if (op === "cancel") r = fd.get("confirm") === "on" ? await staffCancel(m.id, admin.id) : "invalid";
  else if (op === "lapse") r = fd.get("confirm") === "on" ? await staffMarkLapsed(m.id, admin.id) : "invalid";
  else if (op === "renewal") { const d = parseRenewalDay(fd.get("renewsOn")); if (!d) back(locale, m.userId, "err_date", "memberships"); r = await staffSetRenewal(m.id, d, admin.id); }
  else if (op === "reactivate") {
    const raw = String(fd.get("renewsOn") ?? "").trim(); const d = raw ? parseRenewalDay(raw) : null;
    if (raw && !d) back(locale, m.userId, "err_date", "memberships");
    r = await staffReactivate(m.id, d, admin.id);
  }
  back(locale, m.userId, STAFF_MSG[r], "memberships");
}
export async function grantMembership(fd: FormData) {
  const { locale, admin } = await guard(fd); const u = await targetUser(fd, locale);
  const raw = String(fd.get("renewsOn") ?? "").trim(); const d = raw ? parseRenewalDay(raw) : null;
  if (raw && !d) back(locale, u.id, "err_date", "memberships");
  const r = await staffGrant(u.id, String(fd.get("tier") ?? ""), d, admin.id);
  back(locale, u.id, r === "ok" ? "msg_membershipAdded" : STAFF_MSG[r], "memberships");
}

/* ── CPE ledger ── */
const CPE_STATUSES = ["submitted", "approved", "audit"];
const hoursOf = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) / 100 : null; };
export async function addCpe(fd: FormData) {
  const { locale, admin } = await guard(fd); const u = await targetUser(fd, locale);
  const title = cleanText(fd.get("title"), 200), hours = hoursOf(fd.get("hours")), status = String(fd.get("status"));
  if (!title || hours === null || !CPE_STATUSES.includes(status)) back(locale, u.id, "err_cpe", "cpe");
  await db.cpeEntry.create({ data: { userId: u.id, title, hours, status, createdBy: admin.id } });
  await db.auditLog.create({ data: { actor: admin.id, action: "cpe.entry_added", target: u.id } });
  back(locale, u.id, "msg_cpeAdded", "cpe");
}
export async function updateCpe(fd: FormData) {
  const { locale, admin } = await guard(fd);
  const e = await db.cpeEntry.findUnique({ where: { id: idParam(fd.get("id")) } });
  if (!e) redirect(`/${locale}/admin/members?msg=notFound`);
  if (fd.get("op") === "remove") {
    if ((await db.cpeEntry.deleteMany({ where: { id: e.id } })).count) await db.auditLog.create({ data: { actor: admin.id, action: "cpe.entry_removed", target: e.userId } });
    back(locale, e.userId, "msg_cpeRemoved", "cpe");
  }
  const status = String(fd.get("status")); if (!CPE_STATUSES.includes(status)) back(locale, e.userId, "err_cpe", "cpe");
  if (status !== e.status && (await db.cpeEntry.updateMany({ where: { id: e.id, status: e.status }, data: { status, createdBy: admin.id } })).count)
    await db.auditLog.create({ data: { actor: admin.id, action: "cpe.status_changed", target: e.userId } });
  back(locale, e.userId, "msg_cpeSaved", "cpe");
}
