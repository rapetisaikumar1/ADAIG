import { getTranslations, setRequestLocale } from "next-intl/server";
import { login } from "./actions";
import { AuthSide } from "./AuthSide";

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; deleted?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { error, deleted } = await searchParams; const t = await getTranslations("auth"); const tp = await getTranslations("profile");
  return (
    <main id="main" className="auth-wrap"><AuthSide />
      <div className="auth-form"><div>
        <h1 style={{ fontSize: "var(--fs-3xl)" }}>{t("signIn")}</h1>
        <p className="muted">{t("newHere")} <a href={`/${locale}/signup`}>{t("create")}</a></p>
        {deleted && <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}><div>{tp("deleted")}</div></div>}
        {error && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><div>{error === "locked" ? t("locked") : t("invalid")}</div></div>}
        <form action={login}>
          <input type="hidden" name="locale" value={locale} />
          <div className="field"><label htmlFor="le">{t("email")}</label><input id="le" name="email" type="email" required autoComplete="username" /></div>
          <div className="field"><label htmlFor="lp">{t("password")}</label><input id="lp" name="password" type="password" required autoComplete="current-password" /></div>
          <button className="btn btn-accent btn-block">{t("signIn")}</button>
        </form>
        <p className="small muted" style={{ marginTop: 16 }}>{t("ssoSoon")}</p>
      </div></div>
    </main>
  );
}
