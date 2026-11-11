import { getTranslations, setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/site";
import { getTiers } from "@/lib/settings";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";
import { Icon } from "@/components/ui/Icon";

/**
 * Membership tiers. Joining is an application (no online payment), and dues are not yet confirmed by the founding
 * board, so tier cards show no prices: the ADAIG point of contact confirms dues after the application.
 * Compare table, enterprise section and FAQ come from src/content/<locale>/membership.html.
 */
export default async function Membership({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const t = await getTranslations("membership");
  const tiers = await getTiers(); // admin-editable (Admin → Settings); defaults from src/config/site.ts
  const rest = (await loadContent("membership", locale))!.html;
  const tj = await getTranslations("join");
  // The recommended tier comes first (in the DOM too, so reading/tab order matches what is seen) and spans the row as a spotlight.
  const ordered = [...tiers].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  // Keep "Public sector / NFP"-style names from leaving "/ NFP" alone on a line (no wording change: non-breaking spaces only).
  const nb = (name: string) => name.replace(/ \/ /g, "\u00a0/\u00a0");
  return (
    <main id="main" tabIndex={-1} className="mship-page">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container">
        <div className="alert alert-info mship-dues" role="note"><Icon name="info" /><div><b>{t("duesTitle")}</b>{t("duesBody")}</div></div>
        <h2 className="sr-only">{t("tiersHeading")}</h2>
        <div className="grid g4 mship-tiers">
          {ordered.map((tier) => (
            <article key={tier.id} className={`card tier${tier.featured ? " featured" : ""}`}>
              {tier.featured && <span className="badge badge-navy ribbon">{t("popular")}</span>}
              <div className="tier-head"><h3>{nb(tier.name[locale])}</h3><p>{tier.description[locale]}</p></div>
              <ul className="checks">{tier.benefits.map((b, i) => <li key={i}>{b[locale]}</li>)}</ul>
              {tier.requiresVerification && <p className="tier-note">{t("studentNote")}</p>}
              <div className="card-foot">
                <a href={`/${locale}/join?tier=${tier.id}`} className={`btn ${tier.featured ? "btn-highlight" : "btn-secondary"} btn-block`} aria-label={t("applyFor", { tier: tier.name[locale] })}>{t("apply")}</a>
              </div>
            </article>
          ))}
        </div>
        {/* How joining works — the same three steps the application form shows ("What happens next"). */}
        <section className="mship-how" aria-labelledby="mship-how-h">
          <div className="mship-how-head"><h2 id="mship-how-h">{tj("nextTitle")}</h2><p className="small muted mship-how-help">{tj("questions")} <a href={`/${locale}/contact?topic=membership`}>{tj("contactUs")}</a></p></div>
          <ol className="num-list" style={{ ["--cols" as string]: 3 }}>
            <li><h3>{tj("next1Title")}</h3><p>{t.rich("howApplyBody", { link: (c) => <a href={`/${locale}/join`}>{c}</a> })}</p></li>
            <li><h3>{tj("next2Title")}</h3><p>{tj("next2")}</p></li>
            <li><h3>{tj("next3Title")}</h3><p>{tj("next3")}</p></li>
          </ol>
        </section>
      </div></section>
      <Html html={rest} />
    </main>
  );
}
