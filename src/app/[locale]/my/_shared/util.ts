/** Shared helpers for the signed-in member area (/my/*). */
import { eventTimeZone } from "@/components/EventCard";

export const dateLocale = (locale: string) => (locale === "fr" ? "fr-FR" : "en-US");
/** Dates in the member area use ADAIG's operating time zone (US Eastern), like the public event pages. */
export const fmtDate = (d: Date, locale: string, withYear = true) =>
  d.toLocaleDateString(dateLocale(locale), { ...(withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }), timeZone: eventTimeZone } as Intl.DateTimeFormatOptions);
/** "10:30 AM ET" / "10:30 HE" */
export const fmtTime = (d: Date, locale: string) =>
  `${d.toLocaleTimeString(dateLocale(locale), { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ${locale === "fr" ? "HE" : "ET"}`;
/** Day ("12") and short month ("Nov") for the event date block, in Eastern time. */
export const dayMonth = (d: Date, locale: string) => ({
  day: d.toLocaleString(dateLocale(locale), { day: "2-digit", timeZone: eventTimeZone }),
  month: d.toLocaleString(dateLocale(locale), { month: "short", timeZone: eventTimeZone }).replace(".", ""),
});
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
