import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { eventView, eventTypeBadgeClass, eventLocation } from "@/components/EventCard";
import { evLabel, type Locale } from "@/config/site";
import { fmtDate, fmtTime, dayMonth, hasEnded } from "../_shared/util";
import { AccessInfo, accessText } from "../_shared/AccessInfo";
import { memberMetadata } from "../_shared/meta";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("events");

/**
 * The member's own event registrations (live data). Dates and times are shown in Eastern time (ET), like the public event pages.
 * An event stays under "Upcoming" until it ends, so joining details remain visible while it is in progress.
 */
export default async function MyEvents({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const t = await getTranslations("member.eventsPage"); const te = await getTranslations("events");
  const now = new Date();
  const regs = await db.registration.findMany({ where: { userId: u.id, status: { in: ["confirmed", "pending_payment"] }, event: { cancelledAt: null } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } } });
  const upcoming = regs.filter((r) => !hasEnded(r.event, now));
  const past = regs.filter((r) => hasEnded(r.event, now) && r.status === "confirmed").reverse();
  const L = (p: string) => `/${locale}${p}`;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/events" />
      <main id="main" className="app-main mbr">
        <div className="app-head"><h1>{t("title")}</h1><a className="btn btn-primary" href={L("/events")}>{t("browse")}</a></div>
        <h2 className="mbr-section-title" style={{ marginTop: 0 }}>{t("upcoming")}</h2>
        {upcoming.length ? (
          <ul className="mbr-events">{upcoming.map((r) => {
            const d = r.event.startsAt; const dm = dayMonth(d, locale); const v = eventView(r.event, locale); const loc = eventLocation(r.event, te("venueTbc"));
            const access = r.status === "confirmed" ? accessText(r.event, locale) : null; // joining details: confirmed registrants only
            return (
              <li key={r.id} className="card event-card">
                {/* Unconfirmed (proposed) events never show a specific day or time. */}
                <div className="date-block" aria-hidden="true">{v.planned ? <><b>—</b><span>{dm.month}</span></> : <><b>{dm.day}</b><span>{dm.month}</span></>}</div>
                <div className="mbr-ev-body">
                  <div className="tags"><span className={`badge ${r.status === "pending_payment" ? "badge-amber" : "badge-green"}`}>{r.status === "pending_payment" ? t("pendingPay") : t("registered")}</span><span className={eventTypeBadgeClass}>{evLabel(r.event.type, locale)}</span>{v.planned && <span className="badge ev-status">{te("proposed")}</span>}</div>
                  <h3><a href={L(`/events/${r.event.slug}`)}>{v.title}</a></h3>
                  <p className="mbr-ev-meta">{v.planned ? <span>{te("dateTbc")}</span> : <><span>{fmtDate(d, locale)}</span><span>{fmtTime(d, locale, te("tz"))}</span></>}<span>{evLabel(r.event.format, locale)}</span>{loc && <span>{loc}</span>}<span>{r.event.cpe} {t("colCpe")}</span></p>
                  {r.status === "pending_payment" && <p className="small">{t("pendingBody")} <a href={L(`/events/${r.event.slug}`)}>{te("completePayment")} →</a></p>}
                  {access ? <AccessInfo title={t("accessTitle")} text={access} /> : r.status === "confirmed" && r.event.format !== "In person" && <p className="small muted" style={{ margin: 0 }}>{t("accessPending")}</p>}
                </div>
              </li>
            );
          })}</ul>
        ) : (
          <div className="mbr-empty"><p>{t("noUpcoming")}</p></div>
        )}
        <h2 className="mbr-section-title">{t("past")}</h2>
        {past.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("past")}><table>
            <thead><tr><th>{t("colEvent")}</th><th>{t("colDate")}</th><th className="num">{t("colCpe")}</th><th>{t("colAttendance")}</th></tr></thead>
            <tbody>{past.map((r) => <tr key={r.id}>
              <td><a href={L(`/events/${r.event.slug}`)}>{eventView(r.event, locale).title}</a></td>
              <td>{fmtDate(r.event.startsAt, locale)}</td>
              <td className="num">{r.event.cpe}</td>
              <td>{r.attended ? <span className="badge badge-green">{t("attended")}</span> : <span className="muted small">{t("notRecorded")}</span>}</td>
            </tr>)}</tbody>
          </table></div>
        ) : <div className="mbr-empty"><p>{t("noPast")}</p></div>}
      </main>
    </div>
  );
}
