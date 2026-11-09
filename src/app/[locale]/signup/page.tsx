import { getTranslations, setRequestLocale } from "next-intl/server";
import { signup } from "../login/actions";
import { AuthSide } from "../login/AuthSide";

export default async function Signup({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { error } = await searchParams; const t = await getTranslations("auth"); const tj = await getTranslations("join");
  return (
    <main id="main" className="auth-wrap"><AuthSide />
      <div className="auth-form"><div>
        <h1 style={{ fontSize: "var(--fs-3xl)" }}>{t("signupTitle")}</h1>
        <p className="muted">{t("haveAccount")} <a href={`/${locale}/login`}>{t("signIn")}</a></p>
        {error && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><div>{tj.has(`err_${error}`) ? tj(`err_${error}`) : tj("passwordHint")}</div></div>}
        <form action={signup}>
          <input type="hidden" name="locale" value={locale} />
          <div className="field"><label htmlFor="sn">{t("name")}</label><input type="text" id="sn" name="name" required maxLength={100} autoComplete="name" /></div>
          <div className="field"><label htmlFor="se">{t("email")}</label><input id="se" name="email" type="email" required maxLength={254} autoComplete="email" /></div>
          <div className="field"><label htmlFor="sp">{t("password")}</label><input id="sp" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /><span className="hint">{tj("passwordHint")}</span></div>
          <label className="check" style={{ marginBottom: 16 }}><input type="checkbox" name="marketingOptIn" /> {tj("mkt")}</label>
          <button className="btn btn-accent btn-block">{t("createBtn")}</button>
        </form>
      </div></div>
    </main>
  );
}
