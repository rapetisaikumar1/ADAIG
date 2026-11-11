import { evLabel, type Locale } from "@/config/site";
import { EventFields } from "./EventFields";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { AdminHead, AdminTabs, AdminEmpty, AdminReadOnly, type TabItem } from "../_components/AdminUI";
import { eventView, isUnconfirmed, eventTypeBadgeClass, eventTimeZone, dateLocale, eventLocation } from "@/components/EventCard";
import { createEvent, togglePublish } from "./actions";
import { EventFormHelper } from "./EventFormHelper";
export const dynamic = "force-dynamic";

const MSGS: Record<string, string> = { createdDraft: "alert-success", createdPublished: "alert-success", invalid: "alert-danger" };
/** Notices from the event detail page (Admin → Events → Manage), in the adminEvents namespace. */
const OPS_MSGS: Record<string, string> = { deleted: "alert-success", notFound: "alert-danger", cancelledLocked: "alert-danger" };
/** List tabs: upcoming (default, soonest first), drafts (unpublished, not canceled), past (most recent first), all. */
const VIEWS = ["upcoming", "drafts", "past", "all"] as const;
type View = (typeof VIEWS)[number];

export default async function AdminEvents({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ msg?: string; v?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "events", "view"); const me = ctx.user;
  const canCreate = can(ctx, "events", "create"), canEdit = can(ctx, "events", "edit");
  const t = await getTranslations("admin"); const te = await getTranslations("adminEvents"); const tev = await getTranslations("events"); const { msg, v: rawView } = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(String(rawView)) ? (rawView as View) : "upcoming";
  const nowD = new Date(); const now = +nowD; const dl = dateLocale(locale);
  const whereFor = (k: View) => k === "upcoming" ? { startsAt: { gte: nowD } } : k === "past" ? { startsAt: { lt: nowD } } : k === "drafts" ? { published: false, cancelledAt: null } : {};
  const [events, ...countList] = await Promise.all([
    db.event.findMany({ where: whereFor(view), include: { _count: { select: { registrations: { where: { status: "confirmed" } } } } }, orderBy: { startsAt: view === "past" || view === "all" ? "desc" : "asc" } }),
    ...VIEWS.map((k) => db.event.count({ where: whereFor(k) })),
  ]);
  const counts = Object.fromEntries(VIEWS.map((k, i) => [k, countList[i] as number])) as Record<View, number>;
  // Event times are stored as instants and always shown in event time (ET), like the public pages.
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const time = (d: Date) => `${d.toLocaleTimeString(dl, { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ${t("et")}`;
  const tabs: TabItem[] = VIEWS.map((k) => ({ key: k, href: `/${locale}/admin/events${k === "upcoming" ? "" : `?v=${k}`}`, label: t(`evView_${k}`), count: counts[k], current: view === k }));
  const invalid = msg === "invalid";
  const openLabel = canEdit ? te("manage") : te("view"); // read-only roles open the event to view it
  const fieldMsgs = { required: te("fieldRequired"), date: te("fieldDate"), range: String(te.raw("fieldRange")) };
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/events" />
      <main id="main" tabIndex={-1} className="app-main adm-events">
        <AdminHead title={t("events")} lead={canCreate || canEdit ? t("eventsLead") : t("eventsLeadRO")}>
          {canCreate && <>
          {/* "+ New event" (events.create only) is the page's primary action: a disclosure that opens the form under the header (no JavaScript needed);
              it opens by itself after a refused submission so the notice and the form are seen together. */}
          <details className="adm-new" id="new-event" open={invalid || undefined}>
            <summary className="btn btn-primary btn-sm"><span className="when-closed"><Icon name="plus" size={16} /></span><span className="when-closed">{t("newEvent")}</span><span className="when-open"><Icon name="x" size={16} /></span><span className="when-open">{t("closeForm")}</span></summary>
            <form action={createEvent} className="panel adm-new-form" aria-labelledby="new-event-h">
              <header><h2 id="new-event-h">{t("newEvent")}</h2><p>{t("newEventHint")}</p></header>
              {invalid && <div className="alert alert-danger" role="alert" id="new-event-err"><div>{t("ev_invalid")}</div></div>}
              <input type="hidden" name="locale" value={locale} />
              <EventFields locale={locale} />
              <EventFormHelper storageKey="new-event" userId={me.id} restore={invalid} noticeId="new-event-err" msgs={fieldMsgs} />
              <div className="save-row">
                <label className="check"><input type="checkbox" name="publish" /> <span>{t("publishNow")}</span></label>
                <button className="btn btn-accent">{t("create")}</button>
              </div>
            </form>
          </details>
          </>}
        </AdminHead>
        {msg && MSGS[msg] && !invalid && <FocusOnLoad><div className={`alert ${MSGS[msg]} adm-notice`} role="status"><div>{t(`ev_${msg}`)}</div></div></FocusOnLoad>}
        {msg && OPS_MSGS[msg] && <FocusOnLoad><div className={`alert ${OPS_MSGS[msg]} adm-notice`} role="status"><div>{te(`msg_${msg}`)}</div></div></FocusOnLoad>}
        {!canCreate && !canEdit && <AdminReadOnly text={t("readOnly")} />}
        <AdminTabs label={t("evFilterLabel")} items={tabs} />
        {events.length === 0 ? <AdminEmpty title={counts.all === 0 ? t("noEvents") : t("noEventsView")} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("scrollRegion", { name: t("events") })}><table className="adm-table adm-table-ev adm-stack"><caption className="sr-only">{t("events")}</caption><thead><tr><th scope="col">{t("date")}</th><th scope="col">{t("evTitle")}</th><th scope="col" className="adm-col-type">{t("type")}</th><th scope="col" className="num adm-col-md-hide">{t("cpeCol")}</th><th scope="col" className="num adm-col-md-hide">{t("regs2")}</th><th scope="col">{t("status")}</th><th scope="col" className="adm-col-actions"><span className="sr-only">{t("action")}</span></th></tr></thead><tbody>
          {events.map((e) => { const v = eventView(e, locale); const past = +e.startsAt < now; const where = eventLocation(e, tev("venueTbc")); return (
            <tr key={e.id}>
              <td data-label={t("date")}><div className="adm-date"><b>{day(e.startsAt)}</b><span>{time(e.startsAt)}</span></div></td>
              <td data-label={t("evTitle")} className="adm-cell-person"><div className="adm-person"><a href={`/${locale}/admin/events/${e.id}`}>{v.title}</a><span className="small">{evLabel(e.format, locale)}{where ? ` · ${where}` : ""}</span><span className="adm-type-inline"><span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span><span className="small">{t("cpeCol")} {e.cpe} · {t("regs2")} {e._count.registrations}</span></span></div></td>
              <td data-label={t("type")} className="adm-col-type"><span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span></td>
              <td className="num adm-col-md-hide" data-label={t("cpeCol")}>{e.cpe}</td>
              <td className="num adm-col-md-hide" data-label={t("regs2")}>{e._count.registrations}</td>
              <td data-label={t("status")}><div className="tags">{/* one status per row ([18]): a proposed event's state reads "Published · Proposed" */}{e.cancelledAt ? <span className="status status-danger">{te("cancelledBadge")}</span>
                : isUnconfirmed(e) ? <span className="status status-dev" title={t("proposedHint")}>{e.published ? t("publishedBadge") : t("draftBadge")} · {t("proposedBadge")}</span>
                : e.published ? <span className="status status-available">{t("publishedBadge")}</span> : <span className="status status-dev">{t("draftBadge")}</span>}{past && <span className="status status-neutral">{t("past")}</span>}</div></td>
              <td className="adm-col-actions"><div className="adm-actions"><a className="btn btn-sm btn-secondary" href={`/${locale}/admin/events/${e.id}`} aria-label={`${openLabel}: ${v.title}`}>{openLabel}</a>{canEdit && !e.cancelledAt && (e.published && e._count.registrations > 0
                ? /* D10: a live event with registrants is unpublished only after a confirm (same action) */
                  <details className="confirm adm-confirm"><summary className="btn btn-sm btn-secondary" aria-label={`${t("unpublish")}: ${v.title}`}>{t("unpublish")}…</summary>
                    <form action={togglePublish} className="confirm-box"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="locale" value={locale} />{view !== "upcoming" && <input type="hidden" name="v" value={view} />}<p>{t("unpublishConfirm", { title: v.title, n: e._count.registrations })}</p><div className="confirm-actions"><button className="btn btn-danger-outline btn-sm">{t("unpublish")}</button></div></form>
                  </details>
                : <form action={togglePublish}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="locale" value={locale} />{view !== "upcoming" && <input type="hidden" name="v" value={view} />}<button className={`btn btn-sm ${e.published ? "btn-secondary" : "btn-accent"}`} aria-label={`${e.published ? t("unpublish") : t("publish")}: ${v.title}`}>{e.published ? t("unpublish") : t("publish")}</button></form>)}</div></td>
            </tr>
          ); })}
        </tbody></table></div>)}
      </main>
    </div>
  );
}
