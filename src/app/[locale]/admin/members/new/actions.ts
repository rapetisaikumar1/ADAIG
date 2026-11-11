"use server";
import bcrypt from "bcryptjs";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { checkAdminPermission } from "@/lib/rbac";
import { safeLocale, checkPassword, isUniqueViolation } from "@/lib/validation";
import { staffGrant, parseRenewalDay } from "@/lib/membership";
import { getTier } from "@/config/site";
import { parseProfile, tempPassword } from "../_validate";

export type NewAccountState = { error?: string; created?: { id: string; name: string; email: string; password?: string; membershipError?: string } };

/**
 * Staff create an association account (a guest, or a member added offline): profile + password (typed, or generated and shown
 * once) + optional active membership (amount 0, no payment), which makes the guest a member. Never an admin (D1: Admin Portal
 * accounts are created only in Users); any posted "role" field is ignored. Permission: members.create.
 * Audit: admin.account_created (+ membership.granted_by_staff).
 */
export async function createAccount(_: NewAccountState, fd: FormData): Promise<NewAccountState> {
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "adminMembers" });
  const g = await checkAdminPermission("members", "create");
  if (!g.ok) return { error: t(g.reason === "signedOut" ? "err_notAdmin" : "err_forbidden") };
  const admin = g.ctx.user;
  const p = parseProfile(fd); if ("error" in p) return { error: t(p.error) };
  const tierId = String(fd.get("tier") ?? ""); if (tierId && !getTier(tierId)) return { error: t("err_invalid") };
  const rawDay = String(fd.get("renewsOn") ?? "").trim(); const renewsAt = rawDay ? parseRenewalDay(rawDay) : null;
  if (rawDay && !renewsAt) return { error: t("err_date") };
  const typed = String(fd.get("password") ?? ""); const password = typed || tempPassword();
  const pwErr = checkPassword(password, p.data.email); if (pwErr) return { error: t(`err_pw_${pwErr}`) };
  if (await db.user.findUnique({ where: { email: p.data.email } })) return { error: t("err_emailTaken") };
  let id: string;
  try {
    id = (await db.user.create({ data: { ...p.data, role: "guest", passwordHash: await bcrypt.hash(password, 10) } })).id;
  } catch (e) { if (isUniqueViolation(e)) return { error: t("err_emailTaken") }; throw e; }
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.account_created", target: id } });
  let membershipError: string | undefined;
  if (tierId) { const r = await staffGrant(id, tierId, renewsAt, admin.id); if (r !== "ok") membershipError = t("err_openExists"); }
  return { created: { id, name: p.data.name, email: p.data.email, password: typed ? undefined : password, membershipError } };
}
