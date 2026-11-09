import { evLabel } from "@/config/site";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { EventCard } from "@/components/EventCard";
export const dynamic = "force-dynamic";

export default async function Events({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; type?: string; format?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { q, type, format } = await searchParams; const t = await getTranslations("events"); const tm = await getTranslations("membership");
  const events = await db.event.findMany({ where: { published: true, ...(type ? { type } : {}), ...(format ? { format } : {}), ...(q ? { title: { contains: q } } : {}) }, orderBy: { startsAt: "asc" } });
  return (
    <main id="main">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{tm("home")}</a></li><li aria-current="page">{t("title")}</li></ol></nav>
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container">
        <form className="search-bar" style={{ marginBottom: 24 }} role="search">
          <label htmlFor="es" className="sr-only">{t("search")}</label><input id="es" name="q" type="search" defaultValue={q} placeholder={t("search")} />
          <select name="type" aria-label={locale === "fr" ? "Type d’événement" : "Event type"} defaultValue={type ?? ""} style={{ maxWidth: 200 }}><option value="">{t("all")}</option>{["Webinar", "Chapter", "Conference"].map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select>
          <select name="format" aria-label="Format" defaultValue={format ?? ""} style={{ maxWidth: 200 }}><option value="">{locale === "fr" ? "Tous les formats" : "Any format"}</option><option value="Online">{evLabel("Online", locale)}</option><option value="In person">{evLabel("In person", locale)}</option><option value="Hybrid">{evLabel("Hybrid", locale)}</option></select>
          <button className="btn btn-secondary btn-sm">{t("search")}</button>
        </form>
        <div className="grid g2">{events.map((e) => <EventCard key={e.id} e={e} locale={locale} membersFreeLabel={t("membersFree")} />)}</div>
      </div></section>
    </main>
  );
}
