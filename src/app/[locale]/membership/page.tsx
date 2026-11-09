import { getTranslations, setRequestLocale } from "next-intl/server";
import { tiers, type Locale } from "@/config/site";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";

/**
 * Membership tiers. Joining is an application (no online payment), and dues are not yet confirmed by the founding
 * board, so tier cards show no prices: the ADAIG point of contact confirms dues after the application.
 * Compare table, enterprise section and FAQ come from src/content/<locale>/membership.html.
 */
export default async function Membership({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const t = await getTranslations("membership");
  const rest = loadContent("membership", locale)!.html;
  return (
    <main id="main" className="mship-page">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{t("home")}</a></li><li aria-current="page">{t("title")}</li></ol></nav>
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container">
        <div className="mship-dues" role="note">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
          <p><b>{t("duesTitle")}</b> {t("duesBody")}</p>
        </div>
        <div className="grid g4">
          {tiers.map((tier) => (
            <article key={tier.id} className={`card tier${tier.featured ? " featured" : ""}`}>
              {tier.featured && <span className="badge badge-navy ribbon">{t("popular")}</span>}
              <h3>{tier.name[locale]}</h3><p>{tier.description[locale]}</p>
              <ul className="checks">{tier.benefits.map((b, i) => <li key={i}>{b[locale]}</li>)}</ul>
              {tier.requiresVerification && <p className="small">{t("studentNote")}</p>}
              <div className="card-foot">
                <a href={`/${locale}/join?tier=${tier.id}`} className={`btn ${tier.featured ? "btn-highlight" : "btn-secondary"} btn-block`} aria-label={t("applyFor", { tier: tier.name[locale] })}>{t("apply")}</a>
              </div>
            </article>
          ))}
        </div>
      </div></section>
      <Html html={rest} />
    </main>
  );
}
