import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { LangSwitch, NavToggle, PrimaryNav } from "./ClientBits";

export async function SiteHeader({ locale }: { locale: string }) {
  const t = await getTranslations("chrome");
  const s = await auth();
  const L = (p: string) => `/${locale}${p}`;
  const initials = s?.user?.name?.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  return (
    <>
      <a className="skip" href="#main">{t("skip")}</a>
      <div className="placeholder-note" role="note">{t("note")}</div>
      <div className="util"><div className="container">
        <a href={L("/verify")}>{t("verify")}</a><a href={L("/chapters")}>{t("chapters")}</a><a href={L("/careers")}>{t("careers")}</a><a href={L("/contact")}>{t("contact")}</a>
        <LangSwitch />
      </div></div>
      <header className="site-header"><div className="container">
        <a className="brand" href={L("")} aria-label="ADAIG home"><img src="/assets/logo.svg" alt="ADAIG — Association for Data and AI Governance" width={200} height={47} /></a>
        <NavToggle label={t("menu")} />
        <PrimaryNav items={(["about", "membership", "certifications", "learning", "events", "resources", "community", "advocacy"] as const).map((k) => ({ href: L(`/${k}`), label: t(k) }))} />
        {s?.user ? (
          <>
            {s.user.role === "admin" && <a href={L("/admin/dashboard")} className="btn btn-ghost btn-sm header-cta">{t("admin")}</a>}
            <a href={L("/my/dashboard")} className="btn btn-ghost btn-sm header-cta"><span className="avatar" style={{ width: 32, height: 32, fontSize: ".8rem" }}>{initials}</span> {t("myAdaig")}</a>
          </>
        ) : (
          <>
            <a href={L("/login")} className="btn btn-ghost btn-sm header-cta">{t("signIn")}</a>
            <a href={L("/join")} className="btn btn-highlight btn-sm header-cta">{t("join")}</a>
          </>
        )}
      </div></header>
    </>
  );
}

export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations("footer");
  const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  return (
    <footer className="site-footer"><div className="container"><div className="footer-grid">
      <div><img src="/assets/logo-reverse.svg" alt="ADAIG" width={190} height={45} /><p style={{ marginTop: 16, maxWidth: "36ch" }}>{t("tagline")}</p>
        <form aria-label="Newsletter"><label htmlFor="nl" className="sr-only">Email</label><div className="search-bar"><input id="nl" type="email" placeholder="you@example.org" /><button type="button" className="btn btn-accent btn-sm">{t("subscribe")}</button></div><p className="small" style={{ marginTop: 6 }}>{t("casl")}</p></form></div>
      <div><h4>{t("mem")}</h4><ul><li><a href={L("/membership")}>{t("tiers")}</a></li><li><a href={L("/membership#corporate")}>{t("corporate")}</a></li><li><a href={L("/join")}>{t("join")}</a></li><li><a href={L("/vendors")}>{t("vendors")}</a></li></ul></div>
      <div><h4>{t("learn")}</h4><ul><li><a href={L("/certifications")}>{tc("certifications")}</a></li><li><a href={L("/verify")}>{tc("verify")}</a></li><li><a href={L("/learning")}>{t("catalog")}</a></li><li><a href={L("/events")}>{t("eventsW")}</a></li></ul></div>
      <div><h4>{t("engage")}</h4><ul><li><a href={L("/community")}>{tc("community")}</a></li><li><a href={L("/chapters")}>{tc("chapters")}</a></li><li><a href={L("/advocacy")}>{tc("advocacy")}</a></li><li><a href={L("/news")}>{t("news")}</a></li><li><a href={L("/careers")}>{tc("careers")}</a></li></ul></div>
      <div><h4>{t("aboutH")}</h4><ul><li><a href={L("/about")}>{t("mission")}</a></li><li><a href={L("/governance")}>{t("board")}</a></li><li><a href={L("/governance#ethics")}>{t("ethics")}</a></li><li><a href={L("/contact")}>{t("contactFaq")}</a></li></ul></div>
    </div><div className="footer-bottom"><span>{t("copy")}<br /><span className="small">{t("hq")}</span></span><span><a href={L("/legal#privacy")}>{t("privacy")}</a> · <a href={L("/legal#terms")}>{t("terms")}</a> · <a href={L("/legal#accessibility")}>{t("a11y")}</a></span></div></div></footer>
  );
}

export function Html({ html }: { html: string }) {
  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />;
}
