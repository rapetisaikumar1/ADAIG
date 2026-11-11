import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { eventView, eventTypeBadgeClass, eventLocation } from "@/components/EventCard";
import { evLabel, type Locale } from "@/config/site";
import { fmtDate, fmtTime, dayMonth, hasEnded } from "../_shared/util";
import { AccessInfo, accessText } from "../_shared/AccessInfo";
import { memberMetadata } from "../_shared/meta";
import { PageHead, SectionHead, noArrow } from "../_shared/ui";
import { EmptyState, Status } from "@/components/ui/Facet";
import { Icon } from "@/components/ui/Icon";
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
  const td = await getTranslations("dash");
  return (
    <div className="app"><MemberNav locale={locale} current="/my/events" />
      <main id="main" tabIndex={-1} className="app-main mbr mbr-events-page">
        <PageHead title={t("title")} lead={t("lead")} actions={<a className="btn btn-primary" href={L("/events")}><Icon name="calendar" size={18} />{t("browse")}</a>} />

        <section className="mbr-section is-first" aria-labelledby="h-up">
          <SectionHead id="h-up" title={t("upcoming")} count={upcoming.length || undefined} />
          {upcoming.length ? (
            <ul className="mbr-events">{upcoming.map((r) => {
              const d = r.event.startsAt; const dm = dayMonth(d, locale); const v = eventView(r.event, locale); const loc = eventLocation(r.event, te("venueTbc"));
              const access = r.status === "confirmed" ? accessText(r.event, locale) : null; // joining details: confirmed registrants only
              const unpaid = r.status === "pending_payment";
              return (
                <li key={r.id} className={`card event-card mbr-ev${unpaid ? " is-unpaid" : ""}`}>
                  {/* Unconfirmed (proposed) events never show a specific day or time. */}
                  <div className={`date-block${v.planned ? " ev-date-tbc" : ""}`} aria-hidden="true">{v.planned ? <><b>—</b><span>{dm.month}</span></> : <><b>{dm.day}</b><span>{dm.month}</span></>}</div>
                  <div className="mbr-ev-body">
                    <div className="tags"><Status tone={unpaid ? "pending" : "available"}>{unpaid ? t("pendingPay") : t("registered")}</Status><span className={eventTypeBadgeClass}>{evLabel(r.event.type, locale)}</span>{v.planned && <span className="badge ev-status">{te("proposed")}</span>}</div>
                    <h3><a href={L(`/events/${r.event.slug}`)}>{v.title}</a></h3>
                    <ul className="mbr-ev-meta">
                      {v.planned ? <li><Icon name="calendar" size={16} />{te("dateTbc")}</li> : <><li><Icon name="calendar" size={16} />{fmtDate(d, locale)}</li><li><Icon name="clock" size={16} />{fmtTime(d, locale, te("tz"))}</li></>}
                      <li><Icon name={r.event.format === "In person" ? "map-pin" : "video"} size={16} />{evLabel(r.event.format, locale)}{loc && <> · {loc}</>}</li>
                      <li><Icon name="book" size={16} />{r.event.cpe} {t("colCpe")}</li>
                    </ul>
                    {unpaid && <div className="mbr-ev-pay"><p>{t("pendingBody")}</p><a className="btn btn-primary btn-sm" href={L(`/events/${r.event.slug}`)}>{noArrow(te("completePayment"))}</a></div>}
                    {access ? <AccessInfo title={t("accessTitle")} text={access} /> : r.status === "confirmed" && r.event.format !== "In person" && <p className="mbr-access-pending"><Icon name="clock" size={16} />{t("accessPending")}</p>}
                  </div>
                </li>
              );
            })}</ul>
          ) : (
            // The page header already offers "Browse events": no second identical button here (QA-PORTALS-17).
            <EmptyState level={3} title={td("noEventsD")}>{t("noUpcoming")}</EmptyState>
          )}
        </section>

        <section className="mbr-section" aria-labelledby="h-past">
          <SectionHead id="h-past" title={t("past")} count={past.length || undefined} />
          {past.length ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="h-past"><table>
              <thead><tr><th>{t("colEvent")}</th><th>{t("colDate")}</th><th className="num">{t("colCpe")}</th><th>{t("colAttendance")}</th></tr></thead>
              <tbody>{past.map((r) => <tr key={r.id}>
                <td><a href={L(`/events/${r.event.slug}`)}>{eventView(r.event, locale).title}</a></td>
                <td>{fmtDate(r.event.startsAt, locale)}</td>
                <td className="num">{r.event.cpe}</td>
                <td>{r.attended ? <Status tone="success">{t("attended")}</Status> : <span className="muted small">{t("notRecorded")}</span>}</td>
              </tr>)}</tbody>
            </table></div>
          ) : <div className="mbr-empty-sm"><EmptyState level={3} title={t("noPastTitle")}>{t("noPast")}</EmptyState></div>}
        </section>
      </main>
    </div>
  );
}
