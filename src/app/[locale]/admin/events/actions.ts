"use server";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { isUniqueViolation, safeLocale, idParam } from "@/lib/validation";
import { parseEventForm, slugify, SLUG_RE, cpeTitle } from "./eventForm";
import { regView, cleanQuery } from "./views";

/** Create an event. It is saved as a draft unless "publish now" is ticked; invalid input returns to the form with a notice. */
export async function createEvent(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const f = parseEventForm(fd);
  if (!f) redirect(`/${locale}/admin/events?msg=invalid`);
  const slug = slugify(f.title);
  const published = fd.get("publish") === "on";
  const created = await db.event.create({ data: { ...f, slug, published } });
  await db.auditLog.create({ data: { actor: admin.id, action: "event.created", target: created.id } }); // event id: the audit log links it to /admin/events/[id]
  redirect(`/${locale}/admin/events?msg=${published ? "createdPublished" : "createdDraft"}`);
}
/** Publish / unpublish from the list. A cancelled event can't be published again until it is restored (detail page). */
export async function togglePublish(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const e = await db.event.findUnique({ where: { id: idParam(fd.get("id")) } });
  if (e) {
    // Conditional: only flips the state the admin saw, and never publishes a cancelled event (concurrent cancel).
    const r = await db.event.updateMany({ where: { id: e.id, published: e.published, ...(e.published ? {} : { cancelledAt: null }) }, data: { published: !e.published } });
    if (r.count) await db.auditLog.create({ data: { actor: admin.id, action: e.published ? "event.unpublished" : "event.published", target: e.id } });
    else if (e.cancelledAt) redirect(`/${locale}/admin/events?msg=cancelledLocked`);
  }
  redirect(`/${locale}/admin/events`);
}

// ── Event detail page (/admin/events/[id]): edit, cancel/restore, delete, registrations and attendance ──

const eventId = (fd: FormData) => idParam(fd.get("id"));
/** Back to the event page, keeping the registrations filter (whitelisted) and search, with a notice. */
function back(locale: string, id: string, fd: FormData, msg: string, anchor = ""): never {
  const p = new URLSearchParams(); const v = regView(fd.get("v")); const q = cleanQuery(fd.get("q"));
  if (v !== "all") p.set("v", v);
  if (q) p.set("q", q);
  p.set("msg", msg);
  redirect(`/${locale}/admin/events/${encodeURIComponent(id)}?${p}${anchor}`);
}
async function guard(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const id = eventId(fd); const e = id ? await db.event.findUnique({ where: { id } }) : null;
  if (!e) redirect(`/${locale}/admin/events?msg=notFound`);
  return { locale, admin, e };
}

/** Save every field of an event. The slug can change only while the event has no registrations (links and receipts use it). */
export async function updateEvent(fd: FormData) {
  const { locale, admin, e } = await guard(fd);
  const f = parseEventForm(fd);
  if (!f) back(locale, e.id, fd, "invalid", "#edit");
  const slugIn = String(fd.get("slug") ?? e.slug).trim().toLowerCase();
  const slugChanged = slugIn !== e.slug;
  if (slugChanged && (!SLUG_RE.test(slugIn) || slugIn.length > 80)) back(locale, e.id, fd, "slugInvalid", "#edit");
  const published = fd.get("published") === "on";
  if (published && e.cancelledAt) back(locale, e.id, fd, "cancelledLocked", "#edit");
  let count: number;
  try {
    // One conditional write: the slug only changes if there are still no registrations, publishing only if not cancelled meanwhile.
    count = (await db.event.updateMany({
      where: { id: e.id, ...(slugChanged ? { slug: e.slug, registrations: { none: {} } } : {}), ...(published ? { cancelledAt: null } : {}) },
      data: { ...f, published, ...(slugChanged ? { slug: slugIn } : {}) },
    })).count;
  } catch (err) {
    if (isUniqueViolation(err)) back(locale, e.id, fd, "slugTaken", "#edit");
    throw err;
  }
  if (!count) back(locale, e.id, fd, slugChanged ? "slugLocked" : published ? "cancelledLocked" : "conflict", "#edit");
  // CPE already credited from attendance follows the event's title and hours (status, set by staff, is left alone).
  if (f.title !== e.title || f.cpe !== e.cpe) await db.cpeEntry.updateMany({ where: { eventId: e.id }, data: { title: cpeTitle({ ...e, ...f }), hours: f.cpe } });
  // Audit targets are the event id (registration id for registration actions) so Admin → Audit log links to /admin/events/[id].
  await db.auditLog.createMany({ data: [
    { actor: admin.id, action: "event.updated", target: e.id },
    ...(slugChanged ? [{ actor: admin.id, action: "event.slug_changed", target: e.id }] : []),
    ...(published !== e.published ? [{ actor: admin.id, action: published ? "event.published" : "event.unpublished", target: e.id }] : []),
  ] });
  back(locale, e.id, fd, "saved");
}

/** Delete an event that never had a registration (any status). Otherwise staff cancel it instead, which keeps the history. */
export async function deleteEvent(fd: FormData) {
  const { locale, admin, e } = await guard(fd);
  const r = await db.event.deleteMany({ where: { id: e.id, registrations: { none: {} } } });
  if (!r.count) back(locale, e.id, fd, "hasRegistrations", "#danger");
  await db.auditLog.create({ data: { actor: admin.id, action: "event.deleted", target: e.id } });
  redirect(`/${locale}/admin/events?msg=deleted`);
}

/**
 * Cancel an event: it is unpublished and flagged cancelledAt, so it disappears from the public and member pages and takes no
 * registrations. Unpaid tickets (pending_payment) are cancelled so they can't be paid any more. Confirmed registrations are kept as
 * the record of who was registered (export the list to notify them); paid tickets are refunded manually in Stripe.
 */
export async function cancelEvent(fd: FormData) {
  const { locale, admin, e } = await guard(fd);
  const now = new Date();
  const [r, unpaid] = await db.$transaction([
    db.event.updateMany({ where: { id: e.id, cancelledAt: null }, data: { cancelledAt: now, published: false } }),
    db.registration.updateMany({ where: { eventId: e.id, status: "pending_payment" }, data: { status: "cancelled" } }),
  ]);
  if (!r.count) back(locale, e.id, fd, "alreadyCancelled", "#danger");
  await db.auditLog.createMany({ data: [
    { actor: admin.id, action: "event.cancelled", target: e.id },
    ...(unpaid.count ? [{ actor: admin.id, action: "event.unpaid_tickets_cancelled", target: e.id }] : []),
  ] });
  back(locale, e.id, fd, "cancelled");
}
/** Undo a cancellation. The event comes back as a draft; publish it when ready. Cancelled unpaid tickets stay cancelled. */
export async function restoreEvent(fd: FormData) {
  const { locale, admin, e } = await guard(fd);
  const r = await db.event.updateMany({ where: { id: e.id, cancelledAt: { not: null } }, data: { cancelledAt: null } });
  if (r.count) await db.auditLog.create({ data: { actor: admin.id, action: "event.restored", target: e.id } });
  back(locale, e.id, fd, r.count ? "restored" : "notCancelled");
}

/**
 * Mark attendance for one registration ("r") or the ticked ones ("ids", bulk). Only confirmed registrations can be marked.
 * Marking attended credits the event's CPE hours once (CpeEntry with eventId; unique per user+event, so repeats are no-ops);
 * un-marking removes that automatic entry. Each row is one conditional update + CPE change in a transaction.
 */
export async function setAttendance(fd: FormData) {
  const { locale, admin, e } = await guard(fd);
  const to = String(fd.get("to")) === "1";
  const ids = [...new Set([...fd.getAll("ids"), ...fd.getAll("r")].map((x) => String(x).slice(0, 64)).filter(Boolean))].slice(0, 2000);
  if (!ids.length) back(locale, e.id, fd, "noneSelected", "#registrations");
  if (to && e.cancelledAt) back(locale, e.id, fd, "cancelledNoAttendance", "#registrations");
  const rows = await db.registration.findMany({ where: { id: { in: ids }, eventId: e.id, status: "confirmed", attended: !to }, include: { user: { select: { role: true } } } });
  const changed: string[] = [];
  for (const r of rows) {
    const ok = await db.$transaction(async (tx) => {
      const u = await tx.registration.updateMany({ where: { id: r.id, eventId: e.id, status: "confirmed", attended: !to }, data: { attended: to } });
      if (!u.count) return false;
      if (to) {
        // No credit for an anonymized (deleted) account or an event worth 0 CPE.
        if (e.cpe > 0 && r.user.role !== "deleted")
          await tx.cpeEntry.createMany({ data: [{ userId: r.userId, eventId: e.id, title: cpeTitle(e), hours: e.cpe, status: "approved", createdBy: admin.id }], skipDuplicates: true });
      } else {
        await tx.cpeEntry.deleteMany({ where: { userId: r.userId, eventId: e.id } });
      }
      return true;
    });
    if (ok) changed.push(r.id);
  }
  if (changed.length) await db.auditLog.createMany({ data: changed.map((id) => ({ actor: admin.id, action: to ? "event.attendance_marked" : "event.attendance_unmarked", target: id })) });
  const skipped = ids.length - changed.length;
  back(locale, e.id, fd, changed.length ? (skipped ? "attendancePartial" : to ? "attendanceMarked" : "attendanceUnmarked") : "attendanceNone", "#registrations");
}

/**
 * Cancel one registration: only free tickets or unpaid ones (pending_payment). Paid tickets need a refund in Stripe first and are
 * not cancelled here. Any CPE credited for it is removed with it.
 */
export async function cancelRegistration(fd: FormData) {
  const { locale, admin, e } = await guard(fd);
  const id = idParam(fd.get("r"));
  const ok = await db.$transaction(async (tx) => {
    const r = await tx.registration.findFirst({ where: { id, eventId: e.id } });
    if (!r) return false;
    const u = await tx.registration.updateMany({ where: { id, eventId: e.id, OR: [{ status: "pending_payment" }, { status: "confirmed", amountCents: 0 }] }, data: { status: "cancelled", attended: false } });
    if (!u.count) return false;
    await tx.cpeEntry.deleteMany({ where: { userId: r.userId, eventId: e.id } });
    return true;
  });
  if (ok) await db.auditLog.create({ data: { actor: admin.id, action: "event.registration_cancelled", target: id } });
  back(locale, e.id, fd, ok ? "regCancelled" : "regNotCancellable", "#registrations");
}
