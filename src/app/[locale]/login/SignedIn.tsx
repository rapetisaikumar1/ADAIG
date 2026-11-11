import { getTranslations } from "next-intl/server";
import { signOutToSwitch } from "./actions";
import { ClearAdminDrafts } from "@/app/[locale]/admin/_components/ClearAdminDrafts";

/** /login and /signup for someone already signed in: say so and offer their portal home (`home`) or the page they were going to. */
export async function SignedIn({ locale, name, email, next, page, home }: { locale: string; name: string; email: string; next?: string | null; page: "login" | "signup"; home: string }) {
  const t = await getTranslations("auth"); const tc = await getTranslations("chrome");
  return (
    <>
      <span className="eyebrow">{tc("myAdaig")}</span>
      <h1>{t("signedInTitle")}</h1>
      <p className="muted auth-sub">{t("signedInAs", { name, email })}</p>
      <div className="auth-signed-actions">
        {next && <a className="btn btn-primary btn-block" href={next}>{t("continueNext")}</a>}
        <a className={`btn ${next ? "btn-secondary" : "btn-primary"} btn-block`} href={home}>{t("toDashboard")}</a>
      </div>
      {page === "signup" && <div className="auth-join"><b>{t("joinTitle")}</b><p>{t("signedInJoinBody")}</p><a className="link-arrow" href={`/${locale}/join`}>{t("joinLink")}</a></div>}
      <form action={signOutToSwitch} className="auth-switch">
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="page" value={page} />
        {next && <input type="hidden" name="next" value={next} />}
        <ClearAdminDrafts />{/* switching account signs out: drop admin form drafts like every other sign-out (FA3-1) */}
        <button className="btn btn-ghost btn-sm">{t("switchAccount")}</button>
      </form>
    </>
  );
}
