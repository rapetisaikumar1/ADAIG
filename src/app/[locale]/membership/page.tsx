import { getTranslations, setRequestLocale } from "next-intl/server";
import { tiers, currencies, multiCurrency, defaultCurrency, fmt, type Currency, type Locale } from "@/config/site";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";

export default async function Membership({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ cur?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const cur = (currencies.includes((await searchParams).cur as Currency) ? (await searchParams).cur : defaultCurrency) as Currency;
  const t = await getTranslations("membership");
  const proto = loadContent("membership", locale)!.html;
  const rest = proto.slice(proto.indexOf('<section class="section bg-mist">')); // compare table, corporate, FAQ
  return (
    <main id="main">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{t("home")}</a></li><li aria-current="page">{t("title")}</li></ol></nav>
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
        {multiCurrency && <div style={{ marginTop: 16 }}><div className="seg" role="group" aria-label="Currency">
          {currencies.map((c) => <a key={c} href={`?cur=${c}`} role="button" aria-pressed={c === cur}>{c}</a>)}
        </div></div>}
      </div></section>
      <section className="section"><div className="container">
        <div className="alert alert-info" role="note" style={{ marginBottom: 24 }}><div><b>{t("configTitle")}</b>{t("configBody")}</div></div>
        <div className="grid g4">
          {tiers.map((tier) => (
            <article key={tier.id} className={`card tier${tier.featured ? " featured" : ""}`}>
              {tier.featured && <span className="badge badge-navy ribbon">{t("popular")}</span>}
              <h3>{tier.name[locale]}</h3><p>{tier.description[locale]}</p>
              <span className="price"><span>{fmt(tier.price[cur], cur, locale)}</span><small> {t("perYear")}</small></span>
              <ul className="checks">{tier.benefits.map((b, i) => <li key={i}>{b[locale]}</li>)}</ul>
              <div className="card-foot"><a href={`/${locale}/join?tier=${tier.id}&cur=${cur}`} className={`btn ${tier.featured ? "btn-accent" : "btn-secondary"} btn-block`}>{t("choose")} {tier.name[locale]}</a></div>
            </article>
          ))}
        </div>
      </div></section>
      <Html html={rest} />
    </main>
  );
}
