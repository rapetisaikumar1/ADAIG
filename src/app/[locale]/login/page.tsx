import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { safeNextPath } from "@/lib/nextPath";
import { AuthSide } from "./AuthSide";
import { LoginForm } from "./LoginForm";
import { SignedIn } from "./SignedIn";

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; deleted?: string; pw?: string; next?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { error, deleted, pw, next: rawNext } = await searchParams; const t = await getTranslations("auth"); const tp = await getTranslations("profile");
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null, locale) ?? null; // same-site path to return to after signing in
  const s = await auth();
  const withNext = (p: string) => (next ? `${p}?next=${encodeURIComponent(next)}` : p);
  // Errors normally come back as form state; ?error= is still understood (older links, Auth.js error redirects).
  const initialError = error ? (error === "locked" ? t("locked") : t("invalid")) : null;
  return (
    <main id="main" className="auth-wrap"><AuthSide variant="login" />
      <div className="auth-form"><div>
        {s?.user?.id ? <SignedIn locale={locale} name={s.user.name} email={s.user.email} next={next} page="login" /> : <>
          <h1>{t("signIn")}</h1>
          <p className="muted auth-sub">{t.rich("newHereRich", {
            signup: (c) => <a href={withNext(`/${locale}/signup`)}>{c}</a>,
            join: (c) => <a href={`/${locale}/join`}>{c}</a>,
          })}</p>
          {deleted && <div className="alert alert-success" role="status"><div>{tp("deleted")}</div></div>}
          {pw === "changed" && <div className="alert alert-success" role="status"><div>{tp("pwChanged")}</div></div>}
          {next && !error && !deleted && pw !== "changed" && <div className="alert alert-info" role="note"><div>{t("signInToContinue")}</div></div>}
          <LoginForm locale={locale} next={next} initialError={initialError}
            labels={{ email: t("email"), password: t("password"), forgot: t("forgot"), signIn: t("signIn") }} />
        </>}
      </div></div>
    </main>
  );
}
