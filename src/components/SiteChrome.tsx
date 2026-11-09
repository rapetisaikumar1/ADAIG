import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { LangSwitch, NavToggle, PrimaryNav } from "./ClientBits";

export async function SiteHeader({ locale }: { locale: string }) {
  const t = await getTranslations("chrome");
  const s = await auth();
  const L = (p: string) => `/${locale}${p}`;
  const initials = s?.user?.name?.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const ctas = s?.user ? (
    <>
      {s.user.role === "admin" && <a href={L("/admin/dashboard")} className="btn btn-ghost btn-sm">{t("admin")}</a>}
      <a href={L("/my/dashboard")} className="btn btn-ghost btn-sm header-account"><span className="avatar" aria-hidden="true">{initials}</span>{t("myAdaig")}</a>
    </>
  ) : (
    <>
      <a href={L("/login")} className="btn btn-ghost btn-sm">{t("signIn")}</a>
      <a href={L("/join")} className="btn btn-highlight btn-sm">{t("join")}</a>
    </>
  );
  return (
    <>
      <a className="skip" href="#main">{t("skip")}</a>
      <div className="util"><div className="container">
        <nav className="util-links" aria-label={t("utility")}>
          <a href={L("/chapters")}>{t("chapters")}</a><a href={L("/careers")}>{t("careers")}</a><a href={L("/contact")}>{t("contact")}</a>
        </nav>
        <LangSwitch />
      </div></div>
      <header className="site-header"><div className="container">
        <a className="brand" href={L("")} aria-label={t("home")}><img src="/assets/logo.svg" alt="ADAIG — Association for Data and AI Governance" width={220} height={52} /></a>
        <PrimaryNav items={(["about", "membership", "events", "resources", "community", "advocacy"] as const).map((k) => ({ href: L(`/${k}`), label: t(k) }))}>
          <div className="nav-extra">{ctas}</div>
        </PrimaryNav>
        <div className="header-cta">{ctas}</div>
        <NavToggle label={t("menu")} closeLabel={t("close")} />
      </div></header>
    </>
  );
}

export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations("footer");
  const tc = await getTranslations("chrome");
  const s = await auth();
  const L = (p: string) => `/${locale}${p}`;
  const col = (title: string, links: [string, string][]) => (
    <nav className="footer-col" aria-label={title}><h2>{title}</h2><ul>{links.map(([href, label]) => <li key={href}><a href={L(href)}>{label}</a></li>)}</ul></nav>
  );
  return (
    <footer className="site-footer"><div className="container">
      <div className="footer-grid">
        <div className="footer-brand">
          <a href={L("")} aria-label={tc("home")}><img src="/assets/logo-reverse.svg" alt="ADAIG — Association for Data and AI Governance" width={220} height={52} /></a>
          <p className="footer-motto">{t("motto")}</p>
          <p className="footer-tagline">{t("tagline")}</p>
          <div className="footer-news">
            <h2>{t("nlTitle")}</h2>
            <p>{t("nlSoon")} {s?.user ? t("nlSignedIn") : <a href={L("/signup")}>{t("nlCta")}</a>}</p>
          </div>
        </div>
        {col(t("mem"), [["/membership", t("tiers")], ["/membership#corporate", t("corporate")], ["/join", t("join")], ["/vendors", t("vendors")]])}
        {col(t("engage"), [["/events", t("eventsW")], ["/community", tc("community")], ["/chapters", tc("chapters")], ["/advocacy", tc("advocacy")], ["/news", t("news")], ["/careers", tc("careers")]])}
        {col(t("aboutH"), [["/about", t("mission")], ["/principles", t("principles")], ["/governance", t("board")], ["/governance#ethics", t("ethics")], ["/contact", t("contactFaq")]])}
      </div>
      <div className="footer-bottom"><span>{t("copy")}</span><span className="footer-legal"><a href={L("/legal#privacy")}>{t("privacy")}</a><a href={L("/legal#terms")}>{t("terms")}</a><a href={L("/legal#accessibility")}>{t("a11y")}</a></span></div>
    </div></footer>
  );
}

export function Html({ html }: { html: string }) {
  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />;
}
