import { evLabel } from "@/config/site";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { searchParam, likeLiteral } from "@/lib/validation";
import { EventCard, eventView, type EventCardLabels } from "@/components/EventCard";
export const dynamic = "force-dynamic";

const TYPES = ["Webinar", "Chapter", "Conference"];
const FORMATS = ["Online", "In person", "Hybrid"];
/** Case-insensitive "contains" (ILIKE on Postgres), matching the previous SQLite LIKE behavior. */
const ci = (q: string) => ({ contains: likeLiteral(q), mode: "insensitive" as const });

export default async function Events({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string | string[]; type?: string; format?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams; const t = await getTranslations("events"); const tm = await getTranslations("membership");
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
    <main id="main" className="events-page">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{tm("home")}</a></li><li aria-current="page">{t("title")}</li></ol></nav>
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container">
        <form className="ev-filters" role="search" aria-label={t("search")}>
          <div className="ev-q"><label htmlFor="es" className="sr-only">{t("search")}</label><input id="es" name="q" type="search" defaultValue={q} placeholder={t("search")} /></div>
          <div><label htmlFor="et" className="sr-only">{t("typeLabel")}</label><select id="et" name="type" defaultValue={type ?? ""}><option value="">{t("all")}</option>{TYPES.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
          <div><label htmlFor="ef" className="sr-only">{t("formatLabel")}</label><select id="ef" name="format" defaultValue={format ?? ""}><option value="">{t("anyFormat")}</option>{FORMATS.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
          <button className="btn btn-primary">{t("apply")}</button>
        </form>
        <div className="ev-results" role="status">
          <span>{t("count", { count: events.length })}</span>
          {filtered && events.length > 0 && <a href={`/${locale}/events`}>{t("clear")}</a>}
        </div>
        {events.length === 0 ? (
          <div className="card ev-empty"><p>{t("empty")}</p><a className="btn btn-secondary btn-sm" href={`/${locale}/events`}>{t("clear")}</a></div>
        ) : (
          <>
            {upcoming.length > 0 && <div className="grid g2">{upcoming.map((e) => <EventCard key={e.id} e={e} locale={locale} labels={labels} />)}</div>}
            {past.length > 0 && <>
              <h2 className="ev-past-title">{t("pastTitle")}</h2>
              <div className="grid g2">{past.map((e) => <EventCard key={e.id} e={e} locale={locale} labels={labels} />)}</div>
            </>}
          </>
        )}
      </div></section>
      <section className="section bg-mist"><div className="container">
        <div className="section-head"><div><span className="eyebrow">{t("howEyebrow")}</span><h2>{t("howTitle")}</h2></div><a href={`/${locale}/contact`}>{t("questions")} →</a></div>
        <div className="grid g3">
          <div className="card"><span className="icon-tile" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="9" r="6"/><path d="M8.5 14.2 7 22l5-3 5 3-1.5-7.8"/></svg></span><h3>{t("how1t")}</h3><p>{t("how1b")}</p></div>
          <div className="card"><span className="icon-tile" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg></span><h3>{t("how2t")}</h3><p>{t("how2b")}</p></div>
          <div className="card"><span className="icon-tile" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15h6"/></svg></span><h3>{t("how3t")}</h3><p>{t("how3b")}</p></div>
        </div>
      </div></section>
    </main>
  );
}
