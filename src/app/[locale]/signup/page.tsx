import { getTranslations, setRequestLocale } from "next-intl/server";
import { signup } from "../login/actions";
import { AuthSide } from "../login/AuthSide";

export default async function Signup({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { error } = await searchParams; const t = await getTranslations("auth"); const tj = await getTranslations("join");
  const pwErr = !!error?.startsWith("pw_");
  return (
    <main id="main" className="auth-wrap"><AuthSide variant="signup" />
      <div className="auth-form"><div>
        <h1>{t("signupTitle")}</h1>
        <p className="muted auth-sub">{t("haveAccount")} <a href={`/${locale}/login`}>{t("signIn")}</a></p>
        {error && <div className="alert alert-danger" role="alert"><div>{tj.has(`err_${error}`) ? tj(`err_${error}`) : tj("passwordHint")}</div></div>}
        <form action={signup}>
          <input type="hidden" name="locale" value={locale} />
          <div className={`field${error === "name" ? " error" : ""}`}><label htmlFor="sn">{t("name")}</label><input type="text" id="sn" name="name" required maxLength={100} autoComplete="name" aria-invalid={error === "name" || undefined} /></div>
          <div className={`field${error === "email" ? " error" : ""}`}><label htmlFor="se">{t("email")}</label><input id="se" name="email" type="email" required maxLength={254} autoComplete="email" aria-invalid={error === "email" || undefined} /></div>
          <div className={`field${pwErr ? " error" : ""}`}><label htmlFor="sp">{t("password")}</label><input id="sp" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" aria-describedby="sp-hint" aria-invalid={pwErr || undefined} /><span className="hint" id="sp-hint">{tj("passwordHint")}</span></div>
          <label className="check auth-check"><input type="checkbox" name="marketingOptIn" /> {tj("mkt")}</label>
          <button className="btn btn-accent btn-block">{t("createBtn")}</button>
        </form>
        <div className="auth-join">
          <b>{t("joinTitle")}</b>
          <p>{t("joinBody")}</p>
          <a href={`/${locale}/join`}>{t("joinLink")} →</a>
        </div>
      </div></div>
    </main>
  );
}
