import { evLabel, type Locale } from "@/config/site";
import { EventFields } from "./EventFields";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { eventView, isUnconfirmed, eventTypeBadgeClass, eventTimeZone, dateLocale } from "@/components/EventCard";
import { createEvent, togglePublish } from "./actions";
export const dynamic = "force-dynamic";

const MSGS: Record<string, string> = { createdDraft: "alert-success", createdPublished: "alert-success", invalid: "alert-danger" };
/** Notices from the event detail page (Admin → Events → Manage), in the adminEvents namespace. */
const OPS_MSGS: Record<string, string> = { deleted: "alert-success", notFound: "alert-danger", cancelledLocked: "alert-danger" };

export default async function AdminEvents({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin"); const te = await getTranslations("adminEvents"); const { msg } = await searchParams;
  const events = await db.event.findMany({ include: { _count: { select: { registrations: { where: { status: "confirmed" } } } } }, orderBy: { startsAt: "asc" } });
  const now = Date.now(); const dl = dateLocale(locale);
  // Event times are stored as instants and always shown in event time (ET), like the public pages.
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const time = (d: Date) => `${d.toLocaleTimeString(dl, { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ${t("et")}`;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/events" />
      <main id="main" className="app-main">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("events")}</h1></div><a className="btn btn-primary btn-sm" href="#new-event">+ {t("newEvent")}</a></div>
        {msg && MSGS[msg] && <div className={`alert ${MSGS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{t(`ev_${msg}`)}</div></div>}
        {msg && OPS_MSGS[msg] && <div className={`alert ${OPS_MSGS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{te(`msg_${msg}`)}</div></div>}
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")} style={{ marginBottom: 32 }}><table className="adm-table adm-table-ev adm-stack"><caption className="sr-only">{t("events")}</caption><thead><tr><th scope="col">{t("date")}</th><th scope="col">{t("evTitle")}</th><th scope="col">{t("type")}</th><th scope="col" className="num">{t("cpeCol")}</th><th scope="col" className="num">{t("regs2")}</th><th scope="col">{t("status")}</th><th scope="col">{t("action")}</th></tr></thead><tbody>
          {events.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 32 }}>{t("noEvents")}</td></tr>}
          {events.map((e) => { const v = eventView(e, locale); const past = +e.startsAt < now; return (
            <tr key={e.id}>
              <td className="nowrap" data-label={t("date")}>{day(e.startsAt)}<div className="small muted">{time(e.startsAt)}</div></td>
              <td data-label={t("evTitle")}><div className="adm-person"><a href={`/${locale}/events/${e.slug}`}>{v.title}</a><span className="small muted">{evLabel(e.format, locale)}{e.location ? ` · ${e.location}` : ""}</span></div></td>
              <td data-label={t("type")}><span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span></td>
              <td className="num" data-label={t("cpeCol")}>{e.cpe}</td>
              <td className="num" data-label={t("regs2")}>{e._count.registrations}</td>
              <td data-label={t("status")}><div className="adm-actions">{e.cancelledAt ? <span className="badge badge-red">{te("cancelledBadge")}</span> : e.published ? <span className="badge badge-green">{t("publishedBadge")}</span> : <span className="badge">{t("draftBadge")}</span>}{isUnconfirmed(e) && <span className="badge ev-status" title={t("proposedHint")}>{t("proposedBadge")}</span>}{past && <span className="badge">{t("past")}</span>}</div></td>
              <td><div className="adm-actions">{!e.cancelledAt && <form action={togglePublish}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="locale" value={locale} /><button className={`btn btn-sm ${e.published ? "btn-secondary" : "btn-accent"}`} aria-label={`${e.published ? t("unpublish") : t("publish")}: ${v.title}`}>{e.published ? t("unpublish") : t("publish")}</button></form>}<a className="btn btn-sm btn-secondary" href={`/${locale}/admin/events/${e.id}`} aria-label={`${te("manage")}: ${v.title}`}>{te("manage")}</a></div></td>
            </tr>
          ); })}
        </tbody></table></div>
        <form action={createEvent} className="card adm-form" id="new-event">
          <h2 style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{t("newEvent")}</h2>
          <p className="small muted" style={{ margin: "0 0 8px" }}>{t("newEventHint")}</p>
          <input type="hidden" name="locale" value={locale} />
          <EventFields locale={locale} />
          <div className="adm-form-foot">
            <label className="check"><input type="checkbox" name="publish" /> <span>{t("publishNow")}</span></label>
            <button className="btn btn-accent">{t("create")}</button>
          </div>
        </form>
      </main>
    </div>
  );
}
