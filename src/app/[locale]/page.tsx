import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";
import { db } from "@/lib/db";
import { EventCard, type EventCardLabels } from "@/components/EventCard";
import { EmptyState } from "@/components/ui/Facet";
import { SIGNAL_HERO } from "@/components/ui/signalArt.generated";
export const dynamic = "force-dynamic";

/** The hero's signal cube (round 9, reports/round9/DESIGN_R9.md §1.4): the ADAIG mark as an isometric halftone around the amber
 *  core, inlined at the <!--HOME_HERO_ART--> marker so its rings can assemble once and pulse outward (CSS only: home.css
 *  .signal-cube; static under prefers-reduced-motion). Decorative (aria-hidden). */
const HERO_ART = `<span class="home-stack">${SIGNAL_HERO}</span>`;

/** Homepage: static content from src/content/<locale>/home.html; the "Upcoming events" section is rendered live
 *  from the database at the <!--HOME_EVENTS--> marker so it never shows past, stale or unpublished events. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const c = (await loadContent("home", locale))!;
  const [before, after = ""] = c.html.replace("<!--HOME_HERO_ART-->", HERO_ART).split("<!--HOME_EVENTS-->");
  const t = await getTranslations("events"); const th = await getTranslations("home");
  const events = await db.event.findMany({ where: { published: true, cancelledAt: null, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 4 });
  const labels: EventCardLabels = { membersFree: t("membersFree"), proposed: t("proposed"), past: t("past"), upTo: t("upTo"), dateTbc: t("dateTbc"), venueTbc: t("venueTbc") };
  return (
    <main id="main" tabIndex={-1} className="home">
      <Html html={before} />
      <section className="section home-events"><div className="container">
        <div className="section-head reveal">
          <div><span className="eyebrow">{th("upcomingEyebrow")}</span><h2>{t("title")}</h2></div>
          <a className="link-arrow link-tap" href={`/${locale}/events`}>{th("allEventsLink")}</a>
        </div>
        {events.length ? (
          <div className="grid g2 home-events-grid">{events.map((e) => <EventCard key={e.id} e={e} locale={locale} labels={labels} />)}</div>
        ) : (
          <EmptyState level={3} title={th("emptyTitle")}>{th("emptyBody")}</EmptyState>
        )}
      </div></section>
      {after && <Html html={after} />}
    </main>
  );
}
