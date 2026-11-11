"use server";
import { defaultCountry } from "@/config/site";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { getTranslations } from "next-intl/server";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { allowAccountCreation } from "@/lib/rateLimit";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/nextPath";
import { portalHome } from "@/lib/session";
import { effectivePermissions } from "@/lib/permissions";
import { checkPassword, emailOk, normEmail, cleanText, limits, isUniqueViolation, safeLocale } from "@/lib/validation";

/**
 * State returned to the sign-in / sign-up forms (useActionState). Errors are returned, not redirected, so the forms keep what
 * was typed (never the password) and can focus and announce the message. Success redirects (signIn throws NEXT_REDIRECT).
 */
export type AuthState = { error?: string; locked?: boolean; field?: "name" | "email" | "password"; email?: string; name?: string; marketingOptIn?: boolean };

/** The same-site page the visitor came from (`next`, validated), or null. */
const nextTarget = (fd: FormData, locale: string) => safeNextPath(fd.get("next"), locale);
const typed = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? [...v].slice(0, max).join("") : "");

/**
 * Sign in. Success → `next` when present (validated), else the portal home for the account's role: admins → the first Admin
 * Portal module their role can view (else /<locale>/admin/no-access), everyone else → /<locale>/my/billing. signIn runs without its own redirect so the role can be read (from the DB, after the
 * password check) before choosing where to go; the redirect happens outside the try (it throws NEXT_REDIRECT).
 */
export async function login(_: AuthState, fd: FormData): Promise<AuthState> {
  const locale = safeLocale(fd.get("locale"));
  try {
    await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirect: false });
  } catch (e) {
    if (e instanceof AuthError) {
      const t = await getTranslations({ locale, namespace: "auth" });
      const locked = (e as { code?: string }).code === "locked";
      return { error: locked ? t("locked") : t("invalid"), locked, email: typed(fd.get("email"), 254) };
    }
    throw e;
  }
  const next = nextTarget(fd, locale);
  if (next) redirect(next);
  const email = String(fd.get("email") ?? "").toLowerCase().trim(); // normalized like authorize() in src/auth.ts
  const u = await db.user.findUnique({ where: { email }, select: { role: true, adminRole: { select: { id: true, isSystem: true, permissions: true } } } });
  redirect(portalHome(locale, u?.role, u?.role === "admin" ? effectivePermissions(u.adminRole) : null));
}

/** Signup (QA BUG-035/036/038/041). Existing emails get the same generic error as other account failures. */
export async function signup(_: AuthState, fd: FormData): Promise<AuthState> {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const email = normEmail(fd.get("email")); const password = String(fd.get("password") ?? ""); const name = cleanText(fd.get("name"), limits.name);
  const tj = await getTranslations({ locale, namespace: "join" }); const ta = await getTranslations({ locale, namespace: "auth" });
  const fail = (error: string, field?: AuthState["field"]): AuthState =>
    ({ error, field, email: typed(fd.get("email"), 254), name: typed(fd.get("name"), 100), marketingOptIn: fd.get("marketingOptIn") === "on" });
  if (!emailOk(email)) return fail(tj("err_email"), "email");
  if (!name) return fail(ta("err_name"), "name");
  const pwErr = checkPassword(password, email); if (pwErr) return fail(tj(`err_pw_${pwErr}`), "password");
  if (!(await allowAccountCreation().catch(() => true))) return fail(tj("err_rate")); // S1-3 caps, before the bcrypt hash
  const hash = await bcrypt.hash(password, 10); // hashed before the lookup so existing/new emails take the same time
  let created = false;
  try {
    if (!(await db.user.findUnique({ where: { email } }))) {
      await db.user.create({ data: { email, name, passwordHash: hash, role: "guest", country: defaultCountry, locale, marketingOptIn: fd.get("marketingOptIn") === "on" } });
      created = true;
    }
  } catch (e) { if (!isUniqueViolation(e)) throw e; } // double submit / race: treat like an existing email
  if (!created) return fail(tj("err_generic_account"));
  // New accounts are always "guest" (never admin): `next` when present, else the member portal home.
  await signIn("credentials", { email, password, redirectTo: nextTarget(fd, locale) ?? portalHome(locale, "guest") });
  return {};
}

/** "Use another account" on /login and /signup while signed in: sign out on this device and come back to the form. */
export async function signOutToSwitch(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const next = safeNextPath(fd.get("next"), locale);
  const page = fd.get("page") === "signup" ? "signup" : "login";
  await signOut({ redirectTo: `/${locale}/${page}${next ? `?next=${encodeURIComponent(next)}` : ""}` });
}
