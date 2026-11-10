import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { safeNextPath } from "@/lib/nextPath";
import { AuthSide } from "../login/AuthSide";
import { SignedIn } from "../login/SignedIn";
import { SignupForm } from "./SignupForm";

export default async function Signup({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { next: rawNext } = await searchParams; const t = await getTranslations("auth"); const tj = await getTranslations("join");
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null, locale) ?? null; // where to go once the account exists
  const s = await auth();
  return (
    <main id="main" className="auth-wrap"><AuthSide variant="signup" />
      <div className="auth-form"><div>
        {s?.user?.id ? <SignedIn locale={locale} name={s.user.name} email={s.user.email} next={next} page="signup" /> : <>
          <h1>{t("signupTitle")}</h1>
          <p className="muted auth-sub">{t("haveAccount")} <a href={`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>{t("signIn")}</a></p>
          <SignupForm locale={locale} next={next}
            labels={{ name: t("name"), email: t("email"), password: t("password"), passwordHint: tj("passwordHint"), mkt: tj("mkt"), create: t("createBtn") }} />
          <div className="auth-join">
            <b>{t("joinTitle")}</b>
            <p>{t("joinBody")}</p>
            <a href={`/${locale}/join`}>{t("joinLink")} →</a>
          </div>
        </>}
      </div></div>
    </main>
  );
}
