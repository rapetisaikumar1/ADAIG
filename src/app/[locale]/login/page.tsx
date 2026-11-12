import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { safeNextPath } from "@/lib/nextPath";
import { portalHome } from "@/lib/session";
import { AuthSide } from "./AuthSide";
import { LoginForm } from "./LoginForm";
import { SignedIn } from "./SignedIn";
import { Icon } from "@/components/ui/Icon";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; deleted?: string; pw?: string; reset?: string; next?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { error, deleted, pw, reset, next: rawNext } = await searchParams; const t = await getTranslations("auth"); const tp = await getTranslations("profile"); const tc = await getTranslations("chrome");
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null, locale) ?? null; // same-site path to return to after signing in
  const s = await auth();
  const withNext = (p: string) => (next ? `${p}?next=${encodeURIComponent(next)}` : p);
  // Errors normally come back as form state; ?error= is still understood (older links, Auth.js error redirects).
  const initialError = error ? (error === "locked" ? t("locked") : t("invalid")) : null;
  return (
    <main id="main" tabIndex={-1} className="auth-wrap">
      <div className="auth-form"><div>
        {s?.user?.id ? <SignedIn locale={locale} name={s.user.name} email={s.user.email} next={next} page="login" home={portalHome(locale, s.user.role, s.user.permissions)} /> : <>
          <span className="eyebrow">{tc("myAdaig")}</span>
          <h1>{t("signIn")}</h1>
          <p className="muted auth-sub">{t.rich("newHereRich", {
            signup: (c) => <a href={withNext(`/${locale}/signup`)}>{c}</a>,
            join: (c) => <a href={`/${locale}/join`}>{c}</a>,
          })}</p>
          {deleted && <FocusOnLoad><div className="alert alert-success" role="status"><Icon name="check-circle" /><div>{tp("deleted")}</div></div></FocusOnLoad>}
          {pw === "changed" && <FocusOnLoad><div className="alert alert-success" role="status"><Icon name="check-circle" /><div>{tp("pwChanged")}</div></div></FocusOnLoad>}
          {reset === "done" && <FocusOnLoad><div className="alert alert-success" role="status"><Icon name="check-circle" /><div>{t("resetDone")}</div></div></FocusOnLoad>}
          {next && !error && !deleted && pw !== "changed" && reset !== "done" && <div className="alert alert-info" role="note"><Icon name="info" /><div>{t("signInToContinue")}</div></div>}
          <LoginForm locale={locale} next={next} initialError={initialError}
            labels={{ email: t("email"), password: t("password"), forgot: t("forgot"), signIn: t("signIn") }} />
        </>}
      </div></div>
      {/* After the form in the DOM so the h1 is the first heading (QA-FA-13); CSS puts the panel first on wide screens. */}
      <AuthSide variant="login" />
    </main>
  );
}
