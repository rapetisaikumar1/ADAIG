"use server";
import bcrypt from "bcryptjs";
import { getTranslations } from "next-intl/server";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { safeLocale, checkPassword, isUniqueViolation } from "@/lib/validation";
import { staffGrant, parseRenewalDay } from "@/lib/membership";
import { getTier } from "@/config/site";
import { parseProfile, tempPassword } from "../_validate";

export type NewAccountState = { error?: string; created?: { id: string; name: string; email: string; password?: string; membershipError?: string } };
const ROLES = ["guest", "member", "admin"];

/**
 * Staff create an account (staff, or a member added offline): profile + role + password (typed, or generated and shown once)
 * + optional active membership (amount 0, no payment). Audit: admin.account_created (+ membership.granted_by_staff).
 */
export async function createAccount(_: NewAccountState, fd: FormData): Promise<NewAccountState> {
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "adminMembers" });
  const admin = await currentAdmin(); if (!admin) return { error: t("err_notAdmin") };
  const p = parseProfile(fd); if ("error" in p) return { error: t(p.error) };
  const role = String(fd.get("role")); if (!ROLES.includes(role)) return { error: t("err_invalid") };
  const tierId = String(fd.get("tier") ?? ""); if (tierId && !getTier(tierId)) return { error: t("err_invalid") };
  // "Member" comes from a membership (adding one below makes a guest a member); it can't be set without one.
  if (role === "member" && !tierId) return { error: t("err_roleNeedsMembership") };
  const rawDay = String(fd.get("renewsOn") ?? "").trim(); const renewsAt = rawDay ? parseRenewalDay(rawDay) : null;
  if (rawDay && !renewsAt) return { error: t("err_date") };
  const typed = String(fd.get("password") ?? ""); const password = typed || tempPassword();
  const pwErr = checkPassword(password, p.data.email); if (pwErr) return { error: t(`err_pw_${pwErr}`) };
  if (await db.user.findUnique({ where: { email: p.data.email } })) return { error: t("err_emailTaken") };
  let id: string;
  try {
    id = (await db.user.create({ data: { ...p.data, role, passwordHash: await bcrypt.hash(password, 10) } })).id;
  } catch (e) { if (isUniqueViolation(e)) return { error: t("err_emailTaken") }; throw e; }
  // An account created with staff rights is visible as such in the audit log: "<id> (role: admin)".
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.account_created", target: role === "admin" ? `${id} (role: admin)` : id } });
  let membershipError: string | undefined;
  if (tierId) { const r = await staffGrant(id, tierId, renewsAt, admin.id); if (r !== "ok") membershipError = t("err_openExists"); }
  return { created: { id, name: p.data.name, email: p.data.email, password: typed ? undefined : password, membershipError } };
}
