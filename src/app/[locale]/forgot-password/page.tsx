import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthSide } from "../login/AuthSide";
import { ForgotForm } from "./ForgotForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Self-service password reset, step 1 (round 8, EMAIL_SPEC §3): ask for the sign-in email. Same layout as /login. */
export default async function ForgotPassword({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const t = await getTranslations("auth"); const tc = await getTranslations("chrome");
  return (
    <main id="main" tabIndex={-1} className="auth-wrap">
      <div className="auth-form"><div>
        <span className="eyebrow">{tc("myAdaig")}</span>
        <h1>{t("forgotTitle")}</h1>
        <p className="muted auth-sub">{t("forgotLead")}</p>
        <ForgotForm locale={locale} labels={{
          email: t("email"), submit: t("forgotSubmit"), sending: t("forgotSending"), sentTitle: t("forgotSentTitle"),
          sentBody: t("forgotSentBody", { email: "{email}" }),
        }} />
        <p className="small auth-forgot" style={{ marginTop: "var(--sp-5)" }}>{/* below the button here, not above it as on /login */}<a href={`/${locale}/login`}>{t("backToSignIn")}</a></p>
      </div></div>
      {/* After the form in the DOM so the h1 is the first heading; CSS puts the panel first on wide screens (as on /login). */}
      <AuthSide variant="login" />
    </main>
  );
}
