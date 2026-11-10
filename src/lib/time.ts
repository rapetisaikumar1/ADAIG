/**
 * Shared date/time helpers (no server-only imports: safe for server and client components, the seed and scripts).
 * ADAIG operates in US Eastern time: event times, renewal days and audit date filters are all ET (America/New_York).
 * Use these instead of local copies (zoneOffset used to be copied in lib/audit.ts, lib/membership.ts and admin/events/eventForm.ts).
 */
export const eventTimeZone = "America/New_York";

/** Intl locale for formatting dates on /en and /fr pages. */
export const dateLocale = (locale: string) => (locale === "fr" ? "fr-FR" : "en-US");

/** Milliseconds the zone is ahead of UTC at instant `t` (e.g. −4 h for New York in summer). */
export function zoneOffset(t: number, timeZone: string = eventTimeZone): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}

/**
 * A wall-clock time in `timeZone`, given as `Date.UTC(y, m, d, h, min)` of that wall time → the real instant (ms), DST-aware.
 * The second pass settles times near a DST switch. A wall time inside the spring-forward gap maps to a nearby instant:
 * callers that must refuse it compare the result formatted back (see admin/events/eventForm.ts parseEventLocal).
 */
export function wallTimeToInstant(wallUtcMs: number, timeZone: string = eventTimeZone): number {
  const t = wallUtcMs - zoneOffset(wallUtcMs, timeZone);
  return wallUtcMs - zoneOffset(t, timeZone);
}

/** Start (midnight) of a "YYYY-MM-DD" day in the zone, plus `addDays`. */
export function zoneDayStart(day: string, addDays = 0, timeZone: string = eventTimeZone): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(wallTimeToInstant(Date.UTC(y, m - 1, d + addDays), timeZone));
}

/** "YYYY-MM-DD" of an instant in the zone (value for date inputs). */
export const zoneDay = (d: Date, timeZone: string = eventTimeZone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
