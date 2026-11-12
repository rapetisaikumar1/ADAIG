import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { findValidToken } from "@/lib/passwordReset";
import { AuthSide } from "../login/AuthSide";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";
// no-referrer: the token in the URL never leaks through a Referer header.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Self-service password reset, step 2 (round 8, EMAIL_SPEC §3): the link from the email. GET only CHECKS the token (mail
 * scanners prefetch links); it is consumed by the resetPassword action. Unknown, used or expired → the invalid state.
 */
export default async function ResetPassword({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { token: raw } = await searchParams; const token = typeof raw === "string" ? raw : "";
  const t = await getTranslations("auth"); const tc = await getTranslations("chrome");
  const found = await findValidToken(token);
  return (
    <main id="main" tabIndex={-1} className="auth-wrap">
      <div className="auth-form"><div>
        <span className="eyebrow">{tc("myAdaig")}</span>
        <h1>{t("resetTitle")}</h1>
        {found && <p className="muted auth-sub">{t("resetLead", { email: found.user.email })}</p>}
        <ResetForm locale={locale} token={found ? token : ""} initialInvalid={!found} labels={{
          password: t("resetNew"), hint: t("resetHint"), confirm: t("resetConfirm"), submit: t("resetSubmit"), saving: t("resetSaving"),
          invalidTitle: t("resetInvalidTitle"), invalidBody: t("resetInvalidBody"), requestNew: t("resetRequestNew"),
        }} />
        <p className="small auth-forgot" style={{ marginTop: "var(--sp-5)" }}>{/* below the button here, not above it as on /login */}<a href={`/${locale}/login`}>{t("backToSignIn")}</a></p>
      </div></div>
      {/* After the form in the DOM so the h1 is the first heading; CSS puts the panel first on wide screens (as on /login). */}
      <AuthSide variant="login" />
    </main>
  );
}
