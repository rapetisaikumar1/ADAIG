import { evLabel } from "@/config/site";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { searchParam, likeLiteral } from "@/lib/validation";
import { EventCard, eventView, type EventCardLabels } from "@/components/EventCard";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Facet";
export const dynamic = "force-dynamic";

const TYPES = ["Webinar", "Chapter", "Conference"];
const FORMATS = ["Online", "In person", "Hybrid"];
/** Case-insensitive "contains" (ILIKE on Postgres), matching the previous SQLite LIKE behavior. */
const ci = (q: string) => ({ contains: likeLiteral(q), mode: "insensitive" as const });

export default async function Events({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string | string[]; type?: string; format?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams; const t = await getTranslations("events");
  const q = searchParam(sp.q, 200) || undefined; // control characters (Postgres rejects NUL) → spaces
  const type = TYPES.includes(sp.type ?? "") ? sp.type : undefined;
  const format = FORMATS.includes(sp.format ?? "") ? sp.format : undefined;
  const filtered = !!(q || type || format);
  const events = await db.event.findMany({
    where: {
      published: true, cancelledAt: null, ...(type ? { type } : {}), ...(format ? { format } : {}),
      ...(q ? { OR: [{ title: ci(q) }, { titleFr: ci(q) }, { summary: ci(q) }, { summaryFr: ci(q) }, { location: ci(q) }] } : {}),
    },
    orderBy: { startsAt: "asc" },
  });
  const now = new Date();
  const upcoming = events.filter((e) => !eventView(e, locale, now).past);
  const past = events.filter((e) => eventView(e, locale, now).past).reverse();
  const labels: EventCardLabels = { membersFree: t("membersFree"), proposed: t("proposed"), past: t("past"), upTo: t("upTo"), dateTbc: t("dateTbc"), venueTbc: t("venueTbc") };
  return (
    <main id="main" tabIndex={-1} className="events-page">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container">
        <form className="ev-toolbar" role="search" aria-label={t("search")}>
          <div className="ev-q"><label htmlFor="es" className="sr-only">{t("search")}</label><input id="es" name="q" type="search" defaultValue={q} placeholder={t("search")} /></div>
          <div><label htmlFor="et" className="sr-only">{t("typeLabel")}</label><select id="et" name="type" defaultValue={type ?? ""}><option value="">{t("all")}</option>{TYPES.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
          <div><label htmlFor="ef" className="sr-only">{t("formatLabel")}</label><select id="ef" name="format" defaultValue={format ?? ""}><option value="">{t("anyFormat")}</option>{FORMATS.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
          <button className="btn btn-primary">{t("apply")}</button>
        </form>
        <div className="ev-results">
          {/* the count stays announced; with no results the empty state below says it, so the count is visually hidden */}
          <span className={events.length ? "ev-count" : "sr-only"} role="status">{t("count", { count: events.length })}</span>
          {filtered && events.length > 0 && <a className="btn btn-ghost btn-sm" href={`/${locale}/events`}><Icon name="x" size={16} />{t("clear")}</a>}
        </div>
        {events.length === 0 ? (
          <EmptyState title={t("empty")} action={<a className="btn btn-secondary" href={`/${locale}/events`}>{t("clear")}</a>}><a className="link-arrow" href={`/${locale}/contact?topic=events`}>{t("questions")}</a></EmptyState>
        ) : (
          <>
            {upcoming.length > 0 && <><h2 className="sr-only">{t("upcomingTitle")}</h2><div className="grid g3 ev-grid">{upcoming.map((e) => <EventCard key={e.id} e={e} locale={locale} labels={labels} />)}</div></>}
            {past.length > 0 && <>
              <div className="ev-past-head"><h2>{t("pastTitle")}</h2></div>
              <div className="grid g3 ev-grid">{past.map((e) => <EventCard key={e.id} e={e} locale={locale} labels={labels} />)}</div>
            </>}
          </>
        )}
      </div></section>
      <section className="section bg-mist ev-how"><div className="container split is-4-8">
        <div><span className="eyebrow">{t("howEyebrow")}</span><h2>{t("howTitle")}</h2><p><a className="link-arrow link-tap" href={`/${locale}/contact?topic=events`}>{t("questions")}</a></p></div>
        <ol className="num-list">
          <li><h3>{t("how1t")}</h3><p>{t("how1b")}</p></li>
          <li><h3>{t("how2t")}</h3><p>{t("how2b")}</p></li>
          <li><h3>{t("how3t")}</h3><p>{t("how3b")}</p></li>
        </ol>
      </div></section>
    </main>
  );
}
