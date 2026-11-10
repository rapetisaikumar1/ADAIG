"use server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/session";
import { getStripe, mockAllowed } from "@/lib/stripe";
import { isUniqueViolation, safeLocale, idParam } from "@/lib/validation";
import { serverEnv } from "@/lib/env";
import { confirmRegistration } from "@/lib/membership";
import { eventCurrency } from "@/config/site";
import { eventView } from "@/components/EventCard";
import { SLUG_RE } from "@/app/[locale]/admin/events/eventForm";

/** Register for an event. Free tickets confirm immediately; paid tickets go through Stripe (test) or the mock checkout. */
export async function register(fd: FormData) {
  const raw = String(fd.get("slug") ?? ""); const locale = safeLocale(fd.get("locale"));
  const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const e = SLUG_RE.test(raw) && raw.length <= 200 ? await db.event.findUnique({ where: { slug: raw } }) : null;
  if (!e || !e.published || e.cancelledAt) redirect(`/${locale}/events`); // drafts and cancelled events take no registrations
  const slug = e.slug;
  const v = eventView(e, "en"); if (v.planned || v.past) redirect(`/${locale}/events/${slug}`); // proposed (unconfirmed) or ended: no registrations
  const isMember = !!(await activeMembership(s.user.id)); // member price auto-applied (US-7)
  const ticket = isMember ? "member" : "non-member";
  const price = isMember ? e.memberPriceCents : e.publicPriceCents;
  if (price === null) redirect(`/${locale}/events/${slug}?error=tbc`); // non-member price not set yet
  const existing = await db.registration.findUnique({ where: { userId_eventId: { userId: s.user.id, eventId: e.id } } });
  if (existing?.status === "confirmed") redirect(`/${locale}/events/${slug}?registered=1`);
  const data = { ticket, amountCents: price, currency: eventCurrency, status: price === 0 ? "confirmed" : "pending_payment" };
  let r;
  try {
    r = existing ? await db.registration.update({ where: { id: existing.id }, data }) : await db.registration.create({ data: { userId: s.user.id, eventId: e.id, ...data } });
  } catch (err) { // BUG-038: a double submit lost the race on @@unique([userId, eventId]) → reuse the row the other request created
    if (!isUniqueViolation(err)) throw err;
    r = (await db.registration.findUnique({ where: { userId_eventId: { userId: s.user.id, eventId: e.id } } }))!;
    if (r.status === "confirmed") redirect(`/${locale}/events/${slug}?registered=1`);
  }
  if (price === 0) { await db.auditLog.create({ data: { actor: s.user.id, action: "event.registered_free", target: r.id } }); redirect(`/${locale}/events/${slug}?registered=1`); }
  let next = `/${locale}/events/${slug}/checkout?r=${r.id}`;
  const stripe = getStripe();
  if (stripe) {
    const base = serverEnv().APP_URL ?? "http://localhost:3000";
    const cs = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: eventCurrency.toLowerCase(), unit_amount: price, product_data: { name: `${e.title} — ${ticket} ticket` } } }],
      metadata: { registrationId: r.id },
      success_url: `${base}/${locale}/events/${slug}/checkout?r=${r.id}&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/${locale}/events/${slug}`,
    });
    await db.registration.update({ where: { id: r.id }, data: { paymentRef: cs.id } });
    next = cs.url!;
  }
  redirect(next);
}

export async function completeMockTicket(fd: FormData) {
  const id = idParam(fd.get("r")); const locale = safeLocale(fd.get("locale"));
  const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const r = await db.registration.findUnique({ where: { id }, include: { event: true } });
  // replay against someone else's / unknown ticket → friendly notice (never a payment, never a 500)
  if (!r || r.userId !== s.user.id) redirect(`/${locale}/my/dashboard?msg=ticketNotFound`);
  if (r.status === "confirmed") redirect(`/${locale}/events/${r.event.slug}?registered=1`);
  if (r.status !== "pending_payment") redirect(`/${locale}/my/dashboard?msg=ticketNotFound`);
  if (!(await mockAllowed())) redirect(`/${locale}/events/${r.event.slug}/checkout?r=${id}`); // no mock bypass (BUG-024)
  await db.registration.updateMany({ where: { id, status: "pending_payment" }, data: { paymentRef: `mock_${Date.now()}` } }); // idempotent on double click
  await confirmRegistration(id, s.user.id);
  redirect(`/${locale}/events/${r.event.slug}?registered=1`);
}
