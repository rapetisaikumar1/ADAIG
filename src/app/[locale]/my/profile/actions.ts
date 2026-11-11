"use server";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { deleteUserAccount } from "@/lib/account";
import { reserveAttempt, clearFailures, reserveDeleteAttempt, clearDeleteFailures } from "@/lib/rateLimit";
import { safeLocale, cleanText, limits, checkPassword, normCountry, normProvince } from "@/lib/validation";
import { subdivisionsFor } from "@/config/site";

/** Profile text fields and their limits (the form uses the same limits as maxLength). */
const TEXT_FIELDS = { name: limits.name, organisation: limits.organisation, jobTitle: limits.jobTitle } as const;
type TextField = keyof typeof TEXT_FIELDS;
/**
 * Profile fields, same rules as /join and Admin → Members (cleanText: control characters stripped, spaces collapsed,
 * length limits). Blank organisation/job title are stored as "" (as before).
 * A field that can't be saved is left unchanged and reported back; the other fields are still saved:
 * over its limit → `tooLong`; a blank name → `bad` "name" (the current name is kept).
 */
function profileFields(fd: FormData) {
  const blank = (v: FormDataEntryValue | null) => !String(v ?? "").replace(/[\u0000-\u001f\u007f\s]/g, "");
  const data: Partial<Record<TextField, string>> = {}; const tooLong: TextField[] = []; const bad: string[] = [];
  for (const k of Object.keys(TEXT_FIELDS) as TextField[]) {
    const v = fd.get(k);
    if (blank(v)) { if (k !== "name") data[k] = ""; else if (v !== null) bad.push("name"); continue; }
    const s = cleanText(v, TEXT_FIELDS[k]);
    if (s === null) tooLong.push(k); else data[k] = s;
  }
  return { data, tooLong, bad };
}
/**
 * Country + state/province (round 7): same whitelist as /join and Admin → Members; the state is optional (as in Admin) but must
 * belong to the country, and is cleared for countries without a list. Not submitted (older form) or unchanged → left as is,
 * so a legacy stored value never blocks a save. Invalid → both left unchanged and reported (`bad` "country" / "province").
 */
function locationFields(fd: FormData, cur: { country: string; province: string | null }): { data?: { country: string; province: string | null }; bad?: "country" | "province" } {
  const rawCountry = fd.get("country"); if (rawCountry === null) return {};
  const rawProv = String(fd.get("province") ?? "").trim();
  if (String(rawCountry) === cur.country && rawProv === (cur.province ?? "")) return {};
  const country = normCountry(rawCountry); if (!country) return { bad: "country" };
  if (!subdivisionsFor(country)) return { data: { country, province: null } };
  if (!rawProv) return { data: { country, province: null } };
  const province = normProvince(rawProv, country); if (!province) return { bad: "province" };
  return { data: { country, province } };
}
export async function saveProfile(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const cur = await db.user.findUnique({ where: { id: s.user.id }, select: { country: true, province: true, role: true } });
  if (!cur || cur.role === "deleted") redirect(`/${locale}/login`);
  const { data, tooLong, bad } = profileFields(fd);
  const loc = locationFields(fd, cur); if (loc.bad) bad.push(loc.bad);
  // Explicit field list: the id comes from the session only; email, role and membership fields are never read from the form.
  await db.user.update({ where: { id: s.user.id }, data: {
    ...data, ...loc.data, locale: safeLocale(fd.get("prefLocale") ?? locale), directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on",
  } });
  await db.auditLog.create({ data: { actor: s.user.id, action: "profile.updated", target: s.user.id } });
  const q = [tooLong.length && `long=${tooLong.join(",")}`, bad.length && `bad=${bad.join(",")}`].filter(Boolean).join("&");
  redirect(`/${locale}/my/profile?${q || "saved=1"}`);
}

/**
 * Member changes their own password: current password + new password (checkPassword rules) + confirmation.
 * Wrong current passwords count against the same per-account lock as sign-in (src/lib/rateLimit.ts), so a left-open session
 * can't be used to guess the password. On success, sessionVersion is bumped (every session on every device ends, this one
 * included) and the member signs in again with the new password.
 */
export async function changePassword(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const back = (e: string): never => redirect(`/${locale}/my/profile?pw=${e}#h-pw`);
  const current = String(fd.get("currentPassword") ?? ""), next = String(fd.get("newPassword") ?? ""), confirm = String(fd.get("confirmPassword") ?? "");
  const u = await db.user.findUnique({ where: { id: s.user.id }, select: { id: true, email: true, role: true, passwordHash: true } });
  if (!u || u.role === "deleted") redirect(`/${locale}/login`);
  if (!current) back("wrong");
  if (next !== confirm) back("mismatch");
  const pwErr = checkPassword(next, u.email); if (pwErr) back(pwErr);
  if (next === current) back("same");
  if (!(await reserveAttempt(u.email))) back("locked");
  if (!(await bcrypt.compare(current, u.passwordHash))) {
    await db.auditLog.create({ data: { actor: u.id, action: "auth.password_change_failed", target: u.id } });
    back("wrong");
  }
  await clearFailures(u.email);
  const hash = await bcrypt.hash(next, 10);
  // Conditional on the hash we checked: a concurrent staff reset or second change wins, this one then changes nothing.
  const r = await db.user.updateMany({ where: { id: u.id, role: { not: "deleted" }, passwordHash: u.passwordHash }, data: { passwordHash: hash, sessionVersion: { increment: 1 } } });
  if (!r.count) back("wrong");
  await db.auditLog.create({ data: { actor: u.id, action: "auth.password_changed", target: u.id } });
  await signOut({ redirect: false });
  redirect(`/${locale}/login?pw=changed`);
}

/**
 * TC-E2E-006: member self-service account deletion (confirmation box + password), then sign-out.
 * What is removed/anonymised and what is kept is documented on deleteUserAccount() in src/lib/account.ts.
 * Round-7 fixes: Admin Portal accounts (role admin) can't delete themselves (S1 / SEC M-1: Users has no delete, a Super Admin
 * deactivates instead) → ?del=admin. Password attempts are throttled like sign-in (S6 / SEC L-5) on their own counter
 * "del:<userId>" (src/lib/rateLimit.ts), so they never lock or unlock sign-in → ?del=locked while locked.
 */
export async function deleteAccount(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const u = await db.user.findUnique({ where: { id: s.user.id } });
  if (!u || u.role === "deleted") redirect(`/${locale}/login`);
  const back = (e: string): never => redirect(`/${locale}/my/profile?del=${e}`);
  if (u.role === "admin") {
    await db.auditLog.create({ data: { actor: u.id, action: "account.delete_blocked_admin", target: u.id } });
    back("admin");
  }
  const failed = async () => { await db.auditLog.create({ data: { actor: u.id, action: "account.delete_failed_confirmation", target: u.id } }); back("wrong"); };
  if (fd.get("confirm") !== "on") await failed(); // no password is checked without the confirmation, so no attempt is counted
  if (!(await reserveDeleteAttempt(u.id))) back("locked"); // counted BEFORE the password check (atomic; same thresholds as sign-in)
  if (!(await bcrypt.compare(String(fd.get("password") ?? ""), u.passwordHash))) await failed();
  await clearDeleteFailures(u.id);
  // Shared with Admin → Members (src/lib/account.ts): same anonymisation; the last ACTIVE Super Admin can't delete their own account
  // (checked inside the transaction, with the Super Admin rows locked).
  if ((await deleteUserAccount(u.id, { actor: u.id, action: "account.deleted_by_member" })) === "lastAdmin") {
    await db.auditLog.create({ data: { actor: u.id, action: "admin.delete_blocked_last_admin", target: u.id } });
    redirect(`/${locale}/my/profile?del=lastAdmin`);
  }
  await signOut({ redirect: false });
  redirect(`/${locale}/login?deleted=1`);
}
