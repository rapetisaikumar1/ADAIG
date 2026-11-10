import type { Event } from "@/generated/prisma/client";
import { eventView, isUnconfirmed, stripStatus, PROPOSED_SUFFIX } from "@/components/EventCard";
import { eventTimeZone, wallTimeToInstant } from "@/lib/time";

/** Shared by the create and edit forms (Admin → Events): ET date/time conversion and server-side field validation. */

export const EVENT_TYPES = ["Webinar", "Chapter", "Conference"], EVENT_FORMATS = ["Online", "In person", "Hybrid"];

/**
 * The form's datetime-local value ("2026-11-12T12:00") has no zone; staff enter it in event time (America/New_York, ET).
 * Convert that wall-clock time to the real instant, DST-aware (EDT −4 h / EST −5 h). Invalid input → Invalid Date:
 * out-of-range parts (month 13, Feb 31, 25:00) and wall times that don't exist in ET (the spring-forward gap) are refused
 * by checking that the instant formats back to the same ET wall-clock value.
 */
export function parseEventLocal(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(v.trim());
  if (!m) return new Date(NaN);
  const t = wallTimeToInstant(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), eventTimeZone); // DST-aware (src/lib/time.ts)
  if (Number.isNaN(t) || toEventLocal(new Date(t)) !== `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`) return new Date(NaN);
  return new Date(t);
}
/** The inverse of parseEventLocal: an instant → the ET wall-clock value of a datetime-local input ("2026-11-12T12:00"). */
export function toEventLocal(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: eventTimeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Strip control characters (Postgres rejects NUL); single-line fields also fold newlines/tabs into spaces. Over-long input is cut. */
function text(v: FormDataEntryValue | null, max: number, multiline = false) {
  let s = String(v ?? "");
  s = multiline ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ") : s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  return [...s.trim()].slice(0, max).join("").trim();
}
const num = (v: FormDataEntryValue | null, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugify = (title: string) => (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "event") + "-" + Date.now().toString(36);

export type EventFields = Pick<Event, "title" | "titleFr" | "summary" | "summaryFr" | "type" | "format" | "location" | "startsAt" | "durationMin" | "cpe" | "memberPriceCents" | "publicPriceCents" | "accessInfo" | "accessInfoFr">;

/**
 * Validate the event form (create + edit). null = invalid (the page shows the generic "check the fields" notice).
 * The "Proposed" checkbox manages the "(proposed)" title suffix that isUnconfirmed() reads: ticked (or a suffix typed by hand)
 * → the English title gets the suffix; unticked → it is removed (the form shows titles without it, so unticking confirms the
 * event). The French title is always stored without it.
 * Joining details (accessInfo/accessInfoFr) are plain text, shown only to confirmed registrants (rendered as text, never HTML).
 */
export function parseEventForm(fd: FormData): EventFields | null {
  const rawTitle = text(fd.get("title"), 200), rawFr = text(fd.get("titleFr"), 200);
  // Ticked, or a suffix typed by hand (the older convention): the title fields themselves are shown without the suffix.
  const proposed = fd.get("proposed") === "on" || isUnconfirmed({ title: rawTitle, titleFr: rawFr });
  const base = stripStatus(rawTitle).trim(), summary = text(fd.get("summary"), 2000, true);
  const title = base && proposed ? [...base].slice(0, 200 - PROPOSED_SUFFIX.length).join("").trim() + PROPOSED_SUFFIX : base;
  const startsAt = parseEventLocal(String(fd.get("startsAt") ?? "")), type = String(fd.get("type")), format = String(fd.get("format"));
  const durationMin = num(fd.get("durationMin"), 60 * 24 * 14), cpe = num(fd.get("cpe"), 100), member = num(fd.get("memberPrice") || "0", 100000);
  const pubRaw = String(fd.get("publicPrice") ?? "").trim(), pub = pubRaw ? num(pubRaw, 100000) : null;
  if (!title || !summary || isNaN(+startsAt) || !EVENT_TYPES.includes(type) || !EVENT_FORMATS.includes(format) || !durationMin || cpe === null || member === null || (pubRaw && pub === null)) return null;
  return {
    title, titleFr: stripStatus(rawFr).trim() || null, summary, summaryFr: text(fd.get("summaryFr"), 2000, true) || null, type, format,
    location: text(fd.get("location"), 200) || null, startsAt, durationMin: Math.max(1, Math.round(durationMin)), cpe,
    memberPriceCents: Math.round(member * 100), publicPriceCents: pub === null ? null : Math.round(pub * 100),
    accessInfo: text(fd.get("accessInfo"), 2000, true) || null, accessInfoFr: text(fd.get("accessInfoFr"), 2000, true) || null,
  };
}

/** Title written on CPE entries credited from attendance ("(proposed)" suffix removed, English title as in the ledger). */
export const cpeTitle = (e: Event) => eventView(e, "en").title;
