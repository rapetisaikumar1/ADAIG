"use server";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { deleteUserAccount } from "@/lib/account";
import { reserveAttempt, clearFailures } from "@/lib/rateLimit";
import { safeLocale, cleanText, limits, checkPassword } from "@/lib/validation";

/** Profile text fields and their limits (the form uses the same limits as maxLength). */
const TEXT_FIELDS = { name: limits.name, organisation: limits.organisation, jobTitle: limits.jobTitle } as const;
type TextField = keyof typeof TEXT_FIELDS;
/**
 * Profile fields, same rules as /join and Admin → Members (cleanText: control characters stripped, spaces collapsed,
 * length limits). A blank name keeps the current one; blank organisation/job title are stored as "" (as before).
 * A field over its limit is left unchanged and reported back (`tooLong`); the other fields are still saved.
 */
function profileFields(fd: FormData) {
  const blank = (v: FormDataEntryValue | null) => !String(v ?? "").replace(/[\u0000-\u001f\u007f\s]/g, "");
  const data: Partial<Record<TextField, string>> = {}; const tooLong: TextField[] = [];
  for (const k of Object.keys(TEXT_FIELDS) as TextField[]) {
    const v = fd.get(k);
    if (blank(v)) { if (k !== "name") data[k] = ""; continue; }
    const s = cleanText(v, TEXT_FIELDS[k]);
    if (s === null) tooLong.push(k); else data[k] = s;
  }
  return { data, tooLong };
}
export async function saveProfile(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const { data, tooLong } = profileFields(fd);
  await db.user.update({ where: { id: s.user.id }, data: {
    ...data, locale: safeLocale(fd.get("prefLocale") ?? locale), directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on",
  } });
  await db.auditLog.create({ data: { actor: s.user.id, action: "profile.updated", target: s.user.id } });
  redirect(`/${locale}/my/profile?${tooLong.length ? `long=${tooLong.join(",")}` : "saved=1"}`);
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
 */
export async function deleteAccount(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const u = await db.user.findUnique({ where: { id: s.user.id } });
  if (!u || u.role === "deleted") redirect(`/${locale}/login`);
  const ok = fd.get("confirm") === "on" && (await bcrypt.compare(String(fd.get("password") ?? ""), u.passwordHash));
  if (!ok) { await db.auditLog.create({ data: { actor: u.id, action: "account.delete_failed_confirmation", target: u.id } }); redirect(`/${locale}/my/profile?del=wrong`); }
  // Shared with Admin → Members (src/lib/account.ts): same anonymisation, last-admin check inside the transaction.
  if ((await deleteUserAccount(u.id, { actor: u.id, action: "account.deleted_by_member" })) === "lastAdmin") redirect(`/${locale}/my/profile?del=lastAdmin`);
  await signOut({ redirect: false });
  redirect(`/${locale}/login?deleted=1`);
}
