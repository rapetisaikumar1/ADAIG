/** Shared helpers for the signed-in member area (/my/*). */
import { eventTimeZone, dateLocale } from "@/components/EventCard";

/** Dates in the member area use ADAIG's operating time zone (US Eastern), like the public event pages. */
export const fmtDate = (d: Date, locale: string, withYear = true) =>
  d.toLocaleDateString(dateLocale(locale), { ...(withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }), timeZone: eventTimeZone } as Intl.DateTimeFormatOptions);
/** "10:30 AM ET" / "10:30 HE" — `tz` is the translated zone label (events.tz). */
export const fmtTime = (d: Date, locale: string, tz: string) =>
  `${d.toLocaleTimeString(dateLocale(locale), { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ${tz}`;
/** Day ("12") and short month ("Nov") for the event date block, in Eastern time. */
export const dayMonth = (d: Date, locale: string) => ({
  day: d.toLocaleString(dateLocale(locale), { day: "2-digit", timeZone: eventTimeZone }),
  month: d.toLocaleString(dateLocale(locale), { month: "short", timeZone: eventTimeZone }).replace(".", ""),
});
/** Day number of a date's calendar day in Eastern time, so differences count calendar days (Nov 11 → Dec 8 = 27), not 24h blocks. */
export const etDayNumber = (d: Date) => {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: eventTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, day!) / 864e5);
};
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
/**
 * An event counts as "upcoming" in the member area until it ends (start + duration), so an event in progress
 * (e.g. a webinar that started 10 minutes ago) stays listed with its joining details. Used by the dashboard and My events.
 */
export const hasEnded = (e: { startsAt: Date; durationMin: number }, now = new Date()) => +e.startsAt + Math.max(0, e.durationMin) * 60_000 < +now;
/** Staff's former default reason (stored in English before the "no reason given" text existed). */
const LEGACY_DEFAULT_REASON = "Application not approved.";
/**
 * Rejection reason sentence for the member: exactly one closing punctuation mark (staff often end the reason with a
 * period already), or the translated "no reason given" text when the reason is empty or the old English default.
 */
export function rejectionReasonText(reason: string | null | undefined, withReason: (r: string) => string, noReason: string) {
  const r = (reason ?? "").trim();
  if (!r || r === LEGACY_DEFAULT_REASON) return noReason;
  return withReason(/[.!?…]$/.test(r) ? r : `${r}.`);
}
