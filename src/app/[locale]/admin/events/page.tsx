import { evLabel, type Locale } from "@/config/site";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { eventView, isUnconfirmed, eventTypeBadgeClass, eventTimeZone, dateLocale } from "@/components/EventCard";
import { createEvent, togglePublish } from "./actions";
export const dynamic = "force-dynamic";

const MSGS: Record<string, string> = { createdDraft: "alert-success", createdPublished: "alert-success", invalid: "alert-danger" };

export default async function AdminEvents({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin"); const { msg } = await searchParams;
  const events = await db.event.findMany({ include: { _count: { select: { registrations: { where: { status: "confirmed" } } } } }, orderBy: { startsAt: "asc" } });
  const now = Date.now(); const dl = dateLocale(locale);
  // Event times are stored as instants and always shown in event time (ET), like the public pages.
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const time = (d: Date) => `${d.toLocaleTimeString(dl, { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ${t("et")}`;
  const legend = { font: "700 var(--fs-xs) var(--font-body)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--slate-500)", margin: "8px 0 12px" } as const;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/events" />
      <main id="main" className="app-main">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("events")}</h1></div><a className="btn btn-primary btn-sm" href="#new-event">+ {t("newEvent")}</a></div>
        {msg && MSGS[msg] && <div className={`alert ${MSGS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{t(`ev_${msg}`)}</div></div>}
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")} style={{ marginBottom: 32 }}><table className="adm-table adm-table-ev adm-stack"><caption className="sr-only">{t("events")}</caption><thead><tr><th scope="col">{t("date")}</th><th scope="col">{t("evTitle")}</th><th scope="col">{t("type")}</th><th scope="col" className="num">{t("cpeCol")}</th><th scope="col" className="num">{t("regs2")}</th><th scope="col">{t("status")}</th><th scope="col">{t("action")}</th></tr></thead><tbody>
          {events.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 32 }}>{t("noEvents")}</td></tr>}
          {events.map((e) => { const v = eventView(e, locale); const past = +e.startsAt < now; return (
            <tr key={e.id}>
              <td className="nowrap" data-label={t("date")}>{day(e.startsAt)}<div className="small muted">{time(e.startsAt)}</div></td>
              <td data-label={t("evTitle")}><div className="adm-person"><a href={`/${locale}/events/${e.slug}`}>{v.title}</a><span className="small muted">{evLabel(e.format, locale)}{e.location ? ` · ${e.location}` : ""}</span></div></td>
              <td data-label={t("type")}><span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span></td>
              <td className="num" data-label={t("cpeCol")}>{e.cpe}</td>
              <td className="num" data-label={t("regs2")}>{e._count.registrations}</td>
              <td data-label={t("status")}><div className="adm-actions">{e.published ? <span className="badge badge-green">{t("publishedBadge")}</span> : <span className="badge">{t("draftBadge")}</span>}{isUnconfirmed(e) && <span className="badge ev-status" title={t("proposedHint")}>{t("proposedBadge")}</span>}{past && <span className="badge">{t("past")}</span>}</div></td>
              <td><form action={togglePublish}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="locale" value={locale} /><button className={`btn btn-sm ${e.published ? "btn-secondary" : "btn-accent"}`} aria-label={`${e.published ? t("unpublish") : t("publish")}: ${v.title}`}>{e.published ? t("unpublish") : t("publish")}</button></form></td>
            </tr>
          ); })}
        </tbody></table></div>
        <form action={createEvent} className="card adm-form" id="new-event">
          <h2 style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{t("newEvent")}</h2>
          <p className="small muted" style={{ margin: "0 0 8px" }}>{t("newEventHint")}</p>
          <input type="hidden" name="locale" value={locale} />
          <h3 style={legend}>{t("secDetails")}</h3>
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="ti">{t("titleEn")}</label><input type="text" id="ti" name="title" required maxLength={200} /></div>
            <div className="field"><label htmlFor="tf">{t("titleFr")} <span className="hint">({t("optional")})</span></label><input type="text" id="tf" name="titleFr" maxLength={200} /></div>
          </div>
          <div className="field"><label htmlFor="su">{t("summary")}</label><textarea id="su" name="summary" required rows={3} maxLength={2000} /></div>
          <div className="field"><label htmlFor="suf">{t("summaryFr")} <span className="hint">({t("optional")})</span></label><textarea id="suf" name="summaryFr" rows={3} maxLength={2000} /></div>
          <h3 style={legend}>{t("secWhen")}</h3>
          <div className="grid g3" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="ty">{t("type")}</label><select id="ty" name="type">{["Webinar", "Chapter", "Conference"].map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
            <div className="field"><label htmlFor="fo">{t("format")}</label><select id="fo" name="format">{["Online", "In person", "Hybrid"].map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
            <div className="field"><label htmlFor="lo">{t("location")} <span className="hint">({t("optional")})</span></label><input type="text" id="lo" name="location" maxLength={200} /></div>
            <div className="field"><label htmlFor="st">{t("startsAt")} <span className="hint">({t("et")})</span></label><input id="st" name="startsAt" type="datetime-local" required aria-describedby="st-h" /><span className="hint" id="st-h">{t("startsAtHint")}</span></div>
            <div className="field"><label htmlFor="du">{t("duration")}</label><input id="du" name="durationMin" type="number" min={1} defaultValue={60} required /></div>
          </div>
          <h3 style={legend}>{t("secCpePrice")}</h3>
          <div className="grid g3" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="cp">{t("cpeHours")}</label><input id="cp" name="cpe" type="number" step="0.5" min={0} defaultValue={1} required /></div>
            <div className="field"><label htmlFor="mp">{t("memberPrice")}</label><input id="mp" name="memberPrice" type="number" step="0.01" min={0} defaultValue={0} /></div>
            <div className="field"><label htmlFor="pp">{t("publicPrice")}</label><input id="pp" name="publicPrice" type="number" step="0.01" min={0} aria-describedby="pp-h" /><span className="hint" id="pp-h">{t("publicPriceHint")}</span></div>
          </div>
          <div className="adm-form-foot">
            <label className="check"><input type="checkbox" name="publish" /> <span>{t("publishNow")}</span></label>
            <button className="btn btn-accent">{t("create")}</button>
          </div>
        </form>
      </main>
    </div>
  );
}
