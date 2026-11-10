"use server";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { deleteUserAccount } from "@/lib/account";
import { safeLocale, cleanText, limits } from "@/lib/validation";
/**
 * Profile fields, same rules as /join and Admin → Members (cleanText: control characters stripped, spaces collapsed,
 * length limits). A blank name keeps the current one; blank organisation/job title are stored as "" (as before).
 * Returns null when a field is over its limit (nothing is saved then).
 */
function profileFields(fd: FormData) {
  const blank = (v: FormDataEntryValue | null) => !String(v ?? "").replace(/[\u0000-\u001f\u007f\s]/g, "");
  const field = (k: string, max: number) => { const v = fd.get(k); return blank(v) ? "" : cleanText(v, max); };
  const name = field("name", limits.name), organisation = field("organisation", limits.organisation), jobTitle = field("jobTitle", limits.jobTitle);
  if (name === null || organisation === null || jobTitle === null) return null;
  return { name: name || undefined, organisation, jobTitle };
}
export async function saveProfile(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const f = profileFields(fd); if (!f) redirect(`/${locale}/my/profile`); // over-long input (the form has no such limit errors): not saved
  await db.user.update({ where: { id: s.user.id }, data: {
    ...f, locale: safeLocale(fd.get("prefLocale") ?? locale), directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on",
  } });
  await db.auditLog.create({ data: { actor: s.user.id, action: "profile.updated", target: s.user.id } });
  redirect(`/${locale}/my/profile?saved=1`);
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
