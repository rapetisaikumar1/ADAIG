"use server";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { allowPasswordResetRequest, clearFailures, clientIp } from "@/lib/rateLimit";
import { RESET_TTL_MIN, TOKEN_RE, findValidToken, newToken } from "@/lib/passwordReset";
import { notifyPasswordChanged, notifyPasswordResetLink } from "@/lib/notify/account";
import { checkPassword, emailOk, normEmail, safeLocale } from "@/lib/validation";

/**
 * Self-service password reset (round 8, EMAIL_SPEC §3). /forgot-password asks for an email and always answers the same way
 * ("if an account exists…"), whether or not the account exists, is deactivated or deleted, so the page reveals nothing.
 * Everything that depends on the account (lookup, token, audit row, email) runs after the response (after()), and every
 * answer waits until the same minimum time, so the response time reveals nothing either. /reset-password consumes the single-use token (stored hashed, 60 minutes) and sets the new password.
 */
export type ForgotState = { sent?: true; email?: string; error?: string; field?: "email" };
export type ResetState = { error?: string; field?: "password" | "confirm"; invalid?: true };

const MIN_ANSWER_MS = 400; // every request answer takes at least this long (existing or unknown address alike)
const typed = (v: FormDataEntryValue | null) => (typeof v === "string" ? [...v].slice(0, 254).join("") : "");

export async function requestPasswordReset(_: ForgotState, fd: FormData): Promise<ForgotState> {
  const started = Date.now();
  const settle = async <T,>(r: T): Promise<T> => { const wait = started + MIN_ANSWER_MS - Date.now(); if (wait > 0) await new Promise((res) => setTimeout(res, wait)); return r; };
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "auth" });
  if (String(fd.get("website") ?? "").trim()) return settle({ sent: true, email: typed(fd.get("email")) }); // honeypot: pretend
  const email = normEmail(fd.get("email"));
  if (!emailOk(email)) return { error: t("forgotErrEmail"), field: "email", email: typed(fd.get("email")) };
  try {
    if (!(await allowPasswordResetRequest(email))) return settle({ error: t("forgotErrRate"), email });
    // Round-8 SEC L1: the answer path is the same for every address. The account lookup, the token transaction, the audit
    // row and the email all run after the response (after()), so neither the answer nor its timing depends on whether the
    // account exists. Only plain data is captured; the request IP is read here (request APIs belong to the request).
    const requestIp = clientIp(await headers());
    after(() => issueResetLink(email, requestIp));
  } catch {
    console.error("[forgot-password] request failed");
    return settle({ error: t("forgotErrGeneric"), email });
  }
  return settle({ sent: true, email });
}

/** After the response: an active, not deleted account gets a fresh single-use link (older unused links die). Never throws. */
async function issueResetLink(email: string, requestIp: string | null): Promise<void> {
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, active: true } });
    if (!user || !user.active || user.role === "deleted") return;
    const { token, tokenHash } = newToken();
    const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + RESET_TTL_MIN * 60_000);
    const row = await db.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }); // only the newest link works
      const r = await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, createdAt, expiresAt, requestIp }, select: { id: true } });
      await tx.auditLog.create({ data: { actor: "public", action: "auth.password_reset_requested", target: user.id } });
      return r;
    });
    await notifyPasswordResetLink({ to: user.email, userId: user.id, token, tokenId: row.id, createdAt, expiresAt });
  } catch (e) {
    console.error(`[forgot-password] reset link not issued: ${e instanceof Error ? e.name : "error"}`);
  }
}

export async function resetPassword(_: ResetState, fd: FormData): Promise<ResetState> {
  const locale = safeLocale(fd.get("locale"));
  const token = String(fd.get("token") ?? "");
  if (!TOKEN_RE.test(token)) return { invalid: true };
  const found = await findValidToken(token);
  if (!found) return { invalid: true };
  const t = await getTranslations({ locale, namespace: "auth" });
  const password = String(fd.get("password") ?? ""), confirm = String(fd.get("confirm") ?? "");
  if (password !== confirm) return { error: t("resetErr_mismatch"), field: "confirm" };
  const pwErr = checkPassword(password, found.user.email); if (pwErr) return { error: t(`resetErr_${pwErr}`), field: "password" };
  const hash = await bcrypt.hash(password, 10);
  const now = new Date();
  let auditId: string;
  try {
    auditId = await db.$transaction(async (tx) => {
      // Single use: only one request can mark the token used; an expired or already used token changes nothing.
      const used = await tx.passwordResetToken.updateMany({ where: { id: found.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (used.count !== 1) throw new Error("INVALID");
      const u = await tx.user.updateMany({ where: { id: found.user.id, role: { not: "deleted" }, active: true }, data: { passwordHash: hash, sessionVersion: { increment: 1 } } });
      if (u.count !== 1) throw new Error("INVALID");
      await tx.passwordResetToken.deleteMany({ where: { userId: found.user.id, id: { not: found.id } } });
      const a = await tx.auditLog.create({ data: { actor: found.user.id, action: "auth.password_reset_via_email", target: found.user.id }, select: { id: true } });
      return a.id;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID") return { invalid: true };
    throw e;
  }
  await clearFailures(found.user.email); // a locked account can sign in with the new password straight away
  await notifyPasswordChanged({ userId: found.user.id, email: found.user.email, at: now, via: "reset_link", auditId });
  if ((await auth())?.user) await signOut({ redirect: false });
  redirect(`/${locale}/login?reset=done`);
}
