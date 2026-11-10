import { evLabel } from "@/config/site";
import { Fragment } from "react";
import type { Event } from "@/generated/prisma/client";

/** Event-type badges (Webinar / Chapter / Conference) share one neutral navy style; amber/green are reserved for status. */
export const eventTypeBadgeClass = "badge ev-type";

/** Event times are scheduled and shown in US Eastern time (ADAIG operates from New York). */
export const eventTimeZone = "America/New_York";

/** Only one status for unconfirmed events: "Proposed" (legacy "(concept)" titles are treated the same). */
export type EventStatus = "proposed" | null;
const STATUS_RE = /\s*\((proposed|concept|proposée|proposé)\)\s*$/i;
const VENUE_TBC_RE = /^\s*(venue|location)?\s*(to be confirmed|tbc|tbd)\s*\.?\s*$/i;

/**
 * True when staff marked the event as unconfirmed (title ends with "(proposed)" / "(concept)" in Admin → Events).
 * Unconfirmed events show no specific day or time, no prices, take no registrations and are left out of recommendations.
 */
export const isUnconfirmed = (e: Pick<Event, "title"> & Partial<Pick<Event, "titleFr">>) =>
  STATUS_RE.test(e.title) || (!!e.titleFr && STATUS_RE.test(e.titleFr));

/**
 * Display info shared by the event list, card and detail page.
 * We strip the "(proposed)" title suffix and render it as a status badge instead.
 */
export function eventView(e: Event, locale: string, now = new Date()) {
  const raw = locale === "fr" && e.titleFr ? e.titleFr : e.title;
  const status: EventStatus = isUnconfirmed(e) ? "proposed" : null;
  const start = new Date(e.startsAt);
  const end = new Date(start.getTime() + e.durationMin * 60000);
  return { title: raw.replace(STATUS_RE, ""), status, planned: status !== null, past: end < now, start, end };
}

export const dateLocale = (locale: string) => (locale === "fr" ? "fr-FR" : "en-US");

/** Tentative month for an unconfirmed event: "December 2026" / "décembre 2026". */
export const fmtTentativeMonth = (d: Date, locale: string) =>
  d.toLocaleDateString(dateLocale(locale), { month: "long", year: "numeric", timeZone: eventTimeZone });

/** Location with "Venue to be confirmed" placeholders translated (pass the localized label). */
export const eventLocation = (e: Pick<Event, "location">, venueTbc: string) =>
  !e.location ? null : VENUE_TBC_RE.test(e.location) ? venueTbc : e.location;

/** "1.5 CPE" / "1,5 FPC" */
export const fmtCpe = (cpe: number, locale: string) => (locale === "fr" ? `${String(cpe).replace(".", ",")} FPC` : `${cpe} CPE`);

/** "60 min" / "2 h" / "8 h" */
export const fmtDuration = (min: number, locale: string) => {
  if (min < 120) return `${min} min`;
  const h = min / 60;
  return `${locale === "fr" ? String(h).replace(".", ",") : h} h`;
};

export type EventCardLabels = { membersFree: string; proposed: string; past: string; upTo: string; dateTbc: string; venueTbc: string };
const defaultLabels: Record<string, EventCardLabels> = {
  en: { membersFree: "Members free", proposed: "Proposed", past: "Past event", upTo: "up to", dateTbc: "Date to be confirmed", venueTbc: "Venue to be confirmed" },
  fr: { membersFree: "Gratuit pour les membres", proposed: "Proposé", past: "Événement passé", upTo: "jusqu’à", dateTbc: "Date à confirmer", venueTbc: "Lieu à confirmer" },
};
export const eventCardLabels = (locale: string) => defaultLabels[locale] ?? defaultLabels.en;

/** Event summary card (events list, homepage, member dashboard). */
export function EventCard({ e, locale, labels: given, membersFreeLabel }: { e: Event; locale: string; labels?: Partial<EventCardLabels>; membersFreeLabel?: string }) {
  const labels = { ...eventCardLabels(locale), ...given, ...(membersFreeLabel ? { membersFree: membersFreeLabel } : {}) };
  const v = eventView(e, locale);
  const dl = dateLocale(locale);
  const day = v.start.toLocaleString(dl, { day: "2-digit", timeZone: eventTimeZone });
  const month = v.start.toLocaleString(dl, { month: "short", timeZone: eventTimeZone }).replace(".", "");
  const year = v.start.toLocaleString(dl, { year: "numeric", timeZone: eventTimeZone });
  const showYear = year !== new Date().toLocaleString(dl, { year: "numeric", timeZone: eventTimeZone });
  const cpe = v.planned ? `${labels.upTo} ${fmtCpe(e.cpe, locale)}` : fmtCpe(e.cpe, locale);
  const where = eventLocation(e, labels.venueTbc);
  const meta = [evLabel(e.format, locale), where, fmtDuration(e.durationMin, locale), cpe].filter(Boolean) as string[];
  return (
    <article className={`card event-card${v.past ? " ev-past" : ""}`}>
      {v.planned ? (
        // Unconfirmed: no specific day — tentative month and year only.
        <div className="date-block ev-date-tbc" title={`${labels.dateTbc} (${fmtTentativeMonth(v.start, locale)})`}><span>{month}</span><b>{year}</b></div>
      ) : (
        <div className="date-block"><b>{day}</b><span>{month}</span>{showYear && <span className="ev-year">{year}</span>}</div>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        <div className="tags">
          <span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span>
          {v.status && <span className="badge ev-status">{labels.proposed}</span>}
          {v.past && <span className="badge">{labels.past}</span>}
          {!v.planned && !v.past && e.memberPriceCents === 0 && <span className="badge badge-green">{labels.membersFree}</span>}
        </div>
        <h3><a className="card-link" href={`/${locale}/events/${e.slug}`}>{v.title}</a></h3>
        {v.planned && <p className="ev-tbc">{labels.dateTbc}</p>}
        <p className="ev-meta">{meta.map((m, i) => <Fragment key={i}>{i > 0 && " "}<span>{m}</span></Fragment>)}</p>
      </div>
    </article>
  );
}
