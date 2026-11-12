import { db } from "@/lib/db";
import { sendEmail, renderEmail, siteUrl, contactInbox } from "@/lib/email";
import type { EmailFact } from "@/lib/email";
import { eventTimeZone } from "@/lib/time";
import { evLabel, fmt2, type Currency } from "@/config/site";
import { eventView, eventLocation, locationRepeatsFormat, fmtCpe } from "@/components/EventCard";
import { eventAccessInfo } from "@/components/EventAccessInfo";

/**
 * Event emails (round 8, EMAIL_SPEC §2.13–2.14): event.registered (seat confirmed) and event.cancelled (canceled by staff).
 * Server-only. Called after the business action committed; these functions never throw (E2) and log no addresses or bodies.
 * English only for now (E5): the copy lives in COPY, keyed by locale, with links under /en.
 */

const locale = "en";
const L = (path: string) => siteUrl(`/${locale}${path}`);
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: eventTimeZone }); // December 8, 2026
const weekdayDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: eventTimeZone }); // Tuesday, December 8, 2026
const weekdayShort = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: eventTimeZone }); // Tuesday, December 8
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone }); // 2:15 PM

const COPY = {
  en: {
    registered: {
      subject: (title: string) => `You’re registered: ${title}`,
      preheader: (when: string, start: string) => `${when} at ${start} ET. Your seat is confirmed.`,
      heading: "You’re registered",
      hello: "Hello,",
      confirmed: (title: string) => `Your seat for ${title} is confirmed. The event details are below, and you can find them at any time under My events.`,
      access: (info: string) => `How to join (for registered attendees only, please don’t share):\n${info}`,
      accessPending: "Joining details (such as the webinar link or venue instructions) will appear under My events once the ADAIG team adds them.",
      cpe: (cpe: string) => `This session carries ${cpe} credit. CPE credit is recorded in your ADAIG account once your attendance is confirmed.`,
      event: "Event", date: "Date", time: "Time", format: "Format", location: "Location", ticket: "Ticket",
      venueTbc: "Venue to be confirmed",
      member: "Member ticket", nonMember: "Non-member ticket", free: "Free", paid: (amount: string) => `${amount} paid`,
      cta: "View My events",
      footer: "You received this email because you registered for this event with your ADAIG account.",
    },
    cancelled: {
      subject: (title: string) => `Event canceled: ${title}`,
      preheader: (title: string, when: string) => `${title}, planned for ${when}, has been canceled.`,
      heading: "This event has been canceled",
      hello: (name: string) => (name ? `Hello ${name},` : "Hello,"),
      sorry: (title: string, when: string, start: string) => `We’re sorry to let you know that ${title}, planned for ${when} at ${start} ET, has been canceled.`,
      refund: (amount: string) => `You paid ${amount} for your ticket. The ADAIG team will refund your payment.`,
      nothing: "There’s nothing you need to do.",
      thanks: "Thank you for your interest. You can browse other upcoming ADAIG events on our website.",
      event: "Event", planned: "Was planned for", ticket: "Ticket",
      member: "Member ticket", nonMember: "Non-member ticket", paid: (amount: string) => `${amount} paid`,
      cta: "Browse upcoming events",
      footer: "You received this email because you were registered for this event.",
    },
  },
};
const copy = (loc: string) => COPY[loc as keyof typeof COPY] ?? COPY.en;

/** Who may receive event email: never a deleted account, never a deactivated Admin Portal account (EMAIL_SPEC §0.6). */
const reachable = (u: { role: string; active: boolean }) => u.role !== "deleted" && !(u.role === "admin" && !u.active);

/**
 * event.registered: re-reads the registration with its event and user, and sends only when the registration is confirmed, the
 * event is not canceled and the account is reachable. `occurrence` makes the dedupe key: the audit row id of
 * event.registered_free for a free ticket, the payment reference (Stripe session id or mock_…) for a paid one, so the Stripe
 * return page and the webhook share one key and send one email.
 */
export async function notifyEventRegistered(d: { registrationId: string; occurrence: string }): Promise<void> {
  try {
    const r = await db.registration.findUnique({ where: { id: d.registrationId }, include: { event: true, user: { select: { email: true, role: true, active: true } } } });
    if (!r || r.status !== "confirmed" || r.event.cancelledAt || !reachable(r.user)) return;
    const c = copy(locale).registered;
    const e = r.event;
    const v = eventView(e, locale);
    const info = eventAccessInfo(e, locale); // joining details: the registration is confirmed (checked above)
    const where = eventLocation(e, c.venueTbc);
    const paid = r.amountCents > 0;
    const facts: EmailFact[] = [
      { label: c.event, value: v.title },
      { label: c.date, value: weekdayDay(v.start) },
      { label: c.time, value: `${time(v.start)} – ${time(v.end)} ET` },
      { label: c.format, value: evLabel(e.format, locale) },
      ...(where && !locationRepeatsFormat(where, e, locale) ? [{ label: c.location, value: where }] : []),
      { label: c.ticket, value: `${r.ticket === "member" ? c.member : c.nonMember} · ${paid ? c.paid(fmt2(r.amountCents, r.currency as Currency, locale)) : c.free}` },
    ];
    const { html, text } = renderEmail({
      preheader: c.preheader(weekdayShort(v.start), time(v.start)),
      heading: c.heading,
      paragraphs: [
        c.hello,
        c.confirmed(v.title),
        info ? c.access(info.replace(/\r\n?/g, "\n")) : c.accessPending,
        ...(e.cpe > 0 ? [c.cpe(fmtCpe(e.cpe, locale))] : []),
      ],
      facts,
      cta: { label: c.cta, url: L("/my/events") },
      footerNote: c.footer,
      locale,
    });
    const res = await sendEmail({
      kind: "event.registered", to: r.user.email, subject: c.subject(v.title), html, text,
      replyTo: contactInbox() ?? undefined, userId: r.userId,
      dedupeKey: `event.registered:${r.id}:${d.occurrence}`,
    });
    if (res.status === "failed") console.error(`[notify] event.registered: ${res.error ?? "failed"}`);
  } catch (err) {
    console.error(`[notify] event.registered: ${(err as Error)?.name ?? "error"}`);
  }
}

/**
 * event.cancelled: one email per confirmed registration of the event (deleted and deactivated admin accounts skipped), sent one
 * at a time after the response (`after()` in cancelEvent). The dedupe key carries cancelledAt, so a restore followed by a second
 * cancellation emails again, while a re-run of the same cancellation does not.
 */
export async function notifyEventCancelled(d: { eventId: string; cancelledAt: Date }): Promise<void> {
  let sent = 0, failed = 0;
  try {
    const e = await db.event.findUnique({ where: { id: d.eventId } });
    if (!e) return;
    const regs = await db.registration.findMany({
      where: { eventId: e.id, status: "confirmed" },
      include: { user: { select: { name: true, email: true, role: true, active: true } } },
      orderBy: { createdAt: "asc" },
    });
    const c = copy(locale).cancelled;
    const v = eventView(e, locale);
    const when = weekdayDay(v.start), start = time(v.start);
    const stamp = d.cancelledAt.getTime();
    for (const r of regs) {
      if (!reachable(r.user)) continue;
      try {
        const paid = r.amountCents > 0;
        const amount = paid ? fmt2(r.amountCents, r.currency as Currency, locale) : "";
        const { html, text } = renderEmail({
          preheader: c.preheader(v.title, day(v.start)),
          heading: c.heading,
          paragraphs: [c.hello(r.user.name.trim()), c.sorry(v.title, when, start), paid ? c.refund(amount) : c.nothing, c.thanks],
          facts: [
            { label: c.event, value: v.title },
            { label: c.planned, value: `${when} · ${start} ET` },
            { label: c.ticket, value: `${r.ticket === "member" ? c.member : c.nonMember}${paid ? ` · ${c.paid(amount)}` : ""}` },
          ],
          cta: { label: c.cta, url: L("/events") },
          footerNote: c.footer,
          locale,
        });
        const res = await sendEmail({
          kind: "event.cancelled", to: r.user.email, subject: c.subject(v.title), html, text,
          replyTo: contactInbox() ?? undefined, userId: r.userId,
          dedupeKey: `event.cancelled:${r.id}:${stamp}`,
        });
        if (res.status === "sent") sent++; else if (res.status === "failed") failed++;
      } catch { failed++; }
    }
  } catch (err) {
    console.error(`[notify] event.cancelled: ${(err as Error)?.name ?? "error"}`);
  }
  if (failed) console.error(`[notify] event.cancelled: ${failed} failed, ${sent} sent`);
}
