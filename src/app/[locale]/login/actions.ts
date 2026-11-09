"use server";
import { defaultCountry } from "@/config/site";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { db } from "@/lib/db";
import { checkPassword, emailOk, normEmail, cleanText, limits, isUniqueViolation } from "@/lib/validation";

export async function login(fd: FormData) {
  const locale = String(fd.get("locale") ?? "en");
  try {
    await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirectTo: `/${locale}/my/dashboard` });
  } catch (e) {
    if (e instanceof AuthError) redirect(`/${locale}/login?error=${(e as { code?: string }).code === "locked" ? "locked" : "1"}`);
    throw e;
  }
}

/** Signup (QA BUG-035/036/038/041). Existing emails get the same generic error as other account failures. */
export async function signup(fd: FormData) {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const email = normEmail(fd.get("email")); const password = String(fd.get("password") ?? ""); const name = cleanText(fd.get("name"), limits.name);
  const back = (e: string) => redirect(`/${locale}/signup?error=${e}`);
  if (!emailOk(email)) back("email");
  if (!name) back("name");
  const pwErr = checkPassword(password, email); if (pwErr) back(`pw_${pwErr}`);
  const hash = await bcrypt.hash(password, 10); // hashed before the lookup so existing/new emails take the same time
  let created = false;
  try {
    if (!(await db.user.findUnique({ where: { email } }))) {
      await db.user.create({ data: { email, name: name!, passwordHash: hash, role: "guest", country: defaultCountry, locale, marketingOptIn: fd.get("marketingOptIn") === "on" } });
      created = true;
    }
  } catch (e) { if (!isUniqueViolation(e)) throw e; } // double submit / race: treat like an existing email
  if (!created) back("generic_account");
  await signIn("credentials", { email, password, redirectTo: `/${locale}/my/dashboard` });
}
