import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getStripe, mockAllowed, paymentsUnavailable } from "@/lib/stripe";
import { fmt2, type Currency } from "@/config/site";
import { idParam } from "@/lib/validation";
import { completeMockTicket } from "../actions";
import { confirmStripeTicket } from "@/lib/stripeReturn";
import { eventView, eventTimeZone, dateLocale } from "@/components/EventCard";
import { Icon } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";

export default async function TicketCheckout({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ r?: string | string[]; sid?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const slug = encodeURIComponent(idParam((await params).slug, 200)); // only used in redirects back to the event page
  const sp = await searchParams; const id = idParam(sp.r), sid = idParam(sp.sid, 255); const t = await getTranslations("events");
  const s = await auth(); if (!s?.user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/events/${slug}`)}`); // back to the event after signing in
  const r = id ? await db.registration.findUnique({ where: { id }, include: { event: true } }) : null;
  if (!r || r.userId !== s.user.id) redirect(`/${locale}/events/${slug}`);
  if (r.status === "confirmed") redirect(`/${locale}/events/${slug}?registered=1`);
  if (sid && (await confirmStripeTicket(r.id, sid))) redirect(`/${locale}/events/${slug}?registered=1`);
  const stripe = !!getStripe(); const mock = await mockAllowed(); const payErr = await paymentsUnavailable(); const cur = r.currency as Currency;
  const v = eventView(r.event, locale);
  const when = v.start.toLocaleDateString(dateLocale(locale), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const ticket = r.ticket === "member" ? t("member") : t("nonMember");
  return (
    <main id="main" tabIndex={-1} className="event-detail"><section className="section"><div className="container ev-checkout-wrap">
      <div className="card ev-checkout">
        {!payErr && <><h1>{stripe ? t("waitStripe") : t("mockCheckout")}</h1>
        <p className="muted">{stripe ? t("waitStripeBody") : t("mockBody")}</p></>}
        <h2 className="label">{t("orderSummary")}</h2>
        <ul className="ev-prices">
          <li><div><b>{v.title}</b><br /><span className="small muted">{when} · {t("ticketType", { type: ticket.toLowerCase() })}</span></div><b>{fmt2(r.amountCents, cur, locale)}</b></li>
          <li className="ev-total"><span>{t("total")}</span><b>{fmt2(r.amountCents, cur, locale)}</b></li>
        </ul>
        {payErr && <div className="alert alert-danger" role="alert"><Icon name="x-circle" /><div><b>{t("payUnavailable")}</b>{t("payUnavailableBody")}</div></div>}
        {!stripe && mock && <form action={completeMockTicket}><input type="hidden" name="r" value={r.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-accent btn-block">{t("payMock")} {fmt2(r.amountCents, cur, locale)}</button></form>}
        <p className="small ev-back"><a className="link-tap" href={`/${locale}/events/${slug}`}>← {t("back")}</a></p>
      </div>
    </div></section></main>
  );
}
