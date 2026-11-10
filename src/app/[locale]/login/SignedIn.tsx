import { getTranslations } from "next-intl/server";
import { signOutToSwitch } from "./actions";

/** /login and /signup for someone already signed in: say so and offer the dashboard (or the page they were going to). */
export async function SignedIn({ locale, name, email, next, page }: { locale: string; name: string; email: string; next?: string | null; page: "login" | "signup" }) {
  const t = await getTranslations("auth");
  return (
    <>
      <h1>{t("signedInTitle")}</h1>
      <p className="muted auth-sub">{t("signedInAs", { name, email })}</p>
      <div className="auth-signed-actions">
        {next && <a className="btn btn-primary btn-block" href={next}>{t("continueNext")}</a>}
        <a className={`btn ${next ? "btn-secondary" : "btn-primary"} btn-block`} href={`/${locale}/my/dashboard`}>{t("toDashboard")}</a>
      </div>
      {page === "signup" && <div className="auth-join"><b>{t("joinTitle")}</b><p>{t("signedInJoinBody")}</p><a href={`/${locale}/join`}>{t("joinLink")} →</a></div>}
      <form action={signOutToSwitch} className="auth-switch">
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="page" value={page} />
        {next && <input type="hidden" name="next" value={next} />}
        <button className="btn btn-ghost btn-sm">{t("switchAccount")}</button>
      </form>
    </>
  );
}
