"use server";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { safeLocale } from "@/lib/validation";
import { eventTimeZone } from "@/components/EventCard";

const TYPES = ["Webinar", "Chapter", "Conference"], FORMATS = ["Online", "In person", "Hybrid"];
const num = (v: FormDataEntryValue | null) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Milliseconds the given zone is ahead of UTC at instant `t` (e.g. -4 h for New York in summer). */
function zoneOffset(t: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}
/**
 * The form's datetime-local value ("2026-11-12T12:00") has no zone; staff enter it in event time (America/New_York, ET).
 * Convert that wall-clock time to the real instant, DST-aware (EDT −4 h / EST −5 h). Invalid input → Invalid Date.
 */
function parseEventLocal(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(v.trim());
  if (!m) return new Date(NaN);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = wall - zoneOffset(wall, eventTimeZone);
  t = wall - zoneOffset(t, eventTimeZone); // second pass settles times near a DST switch
  return new Date(t);
}

/** Create an event. It is saved as a draft unless "publish now" is ticked; invalid input returns to the form with a notice. */
export async function createEvent(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const title = String(fd.get("title") ?? "").trim().slice(0, 200), summary = String(fd.get("summary") ?? "").trim().slice(0, 2000);
  const startsAt = parseEventLocal(String(fd.get("startsAt") ?? "")), type = String(fd.get("type")), format = String(fd.get("format"));
  const durationMin = num(fd.get("durationMin")), cpe = num(fd.get("cpe")), member = num(fd.get("memberPrice") || "0");
  const pubRaw = String(fd.get("publicPrice") ?? "").trim(), pub = pubRaw ? num(pubRaw) : null;
  if (!title || !summary || isNaN(+startsAt) || !TYPES.includes(type) || !FORMATS.includes(format) || !durationMin || cpe === null || member === null || (pubRaw && pub === null)) redirect(`/${locale}/admin/events?msg=invalid`);
  const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "event") + "-" + Date.now().toString(36);
  const published = fd.get("publish") === "on";
  await db.event.create({ data: { slug, title, titleFr: String(fd.get("titleFr") ?? "").trim().slice(0, 200) || null, summary, summaryFr: String(fd.get("summaryFr") ?? "").trim().slice(0, 2000) || null, type, format, location: String(fd.get("location") ?? "").trim().slice(0, 200) || null,
    startsAt, durationMin: Math.round(durationMin), cpe, memberPriceCents: Math.round(member * 100), publicPriceCents: pub === null ? null : Math.round(pub * 100), published } });
  await db.auditLog.create({ data: { actor: admin.id, action: "event.created", target: slug } });
  redirect(`/${locale}/admin/events?msg=${published ? "createdPublished" : "createdDraft"}`);
}
export async function togglePublish(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const e = await db.event.findUnique({ where: { id: String(fd.get("id")) } });
  if (e) {
    await db.event.update({ where: { id: e.id }, data: { published: !e.published } });
    await db.auditLog.create({ data: { actor: admin.id, action: e.published ? "event.unpublished" : "event.published", target: e.slug } });
  }
  redirect(`/${locale}/admin/events`);
}
