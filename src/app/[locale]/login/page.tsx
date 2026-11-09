import { getTranslations, setRequestLocale } from "next-intl/server";
import { login } from "./actions";
import { AuthSide } from "./AuthSide";

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; deleted?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { error, deleted } = await searchParams; const t = await getTranslations("auth"); const tp = await getTranslations("profile");
  return (
    <main id="main" className="auth-wrap"><AuthSide variant="login" />
      <div className="auth-form"><div>
        <h1>{t("signIn")}</h1>
        <p className="muted auth-sub">{t.rich("newHereRich", {
          signup: (c) => <a href={`/${locale}/signup`}>{c}</a>,
          join: (c) => <a href={`/${locale}/join`}>{c}</a>,
        })}</p>
        {deleted && <div className="alert alert-success" role="status"><div>{tp("deleted")}</div></div>}
        {error && <div className="alert alert-danger" role="alert"><div>{error === "locked" ? t("locked") : t("invalid")}</div></div>}
        <form action={login}>
          <input type="hidden" name="locale" value={locale} />
          <div className="field"><label htmlFor="le">{t("email")}</label><input id="le" name="email" type="email" required autoComplete="username" aria-invalid={error && error !== "locked" ? true : undefined} /></div>
          <div className="field"><label htmlFor="lp">{t("password")}</label><input id="lp" name="password" type="password" required autoComplete="current-password" aria-invalid={error && error !== "locked" ? true : undefined} /></div>
          <p className="small auth-forgot"><a href={`/${locale}/contact?topic=account`}>{t("forgot")}</a></p>
          <button className="btn btn-accent btn-block">{t("signIn")}</button>
        </form>
      </div></div>
    </main>
  );
}
