import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";
import { db } from "@/lib/db";
import { EventCard, type EventCardLabels } from "@/components/EventCard";
export const dynamic = "force-dynamic";

/** Homepage: static content from src/content/<locale>/home.html; the "Upcoming events" section is rendered live
 *  from the database at the <!--HOME_EVENTS--> marker so it never shows past, stale or unpublished events. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const c = (await loadContent("home", locale))!;
  const [before, after = ""] = c.html.split("<!--HOME_EVENTS-->");
  const t = await getTranslations("events");
  const events = await db.event.findMany({ where: { published: true, cancelledAt: null, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 4 });
  const fr = locale === "fr";
  const labels: EventCardLabels = { membersFree: t("membersFree"), proposed: t("proposed"), past: t("past"), upTo: t("upTo"), dateTbc: t("dateTbc"), venueTbc: t("venueTbc") };
  return (
    <main id="main">
      <Html html={before} />
      <section className="section"><div className="container">
        <div className="section-head"><div><span className="eyebrow">{fr ? "À venir" : "Upcoming"}</span><h2>{t("title")}</h2></div><a href={`/${locale}/events`}>{fr ? "Tous les événements →" : "All events →"}</a></div>
        {events.length ? (
          <div className="grid g2">{events.map((e) => <EventCard key={e.id} e={e} locale={locale} labels={labels} />)}</div>
        ) : (
          <div className="card"><h3>{fr ? "Aucun événement à venir pour le moment" : "No upcoming events scheduled yet"}</h3><p className="muted">{fr ? "Les prochaines séances seront annoncées ici dès qu’elles seront confirmées." : "New sessions will be announced here as soon as they are confirmed."}</p></div>
        )}
      </div></section>
      {after && <Html html={after} />}
    </main>
  );
}
