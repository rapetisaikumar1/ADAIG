import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getStripe, mockAllowed, paymentsUnavailable } from "@/lib/stripe";
import { fmt2, type Currency } from "@/config/site";
import { completeMockTicket, confirmStripeTicket } from "../actions";
export const dynamic = "force-dynamic";

export default async function TicketCheckout({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ r?: string; sid?: string }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const { r: id, sid } = await searchParams; const t = await getTranslations("events");
  const s = await auth(); if (!s?.user) redirect(`/${locale}/login`);
  const r = id ? await db.registration.findUnique({ where: { id }, include: { event: true } }) : null;
  if (!r || r.userId !== s.user.id) redirect(`/${locale}/events/${slug}`);
  if (r.status === "confirmed") redirect(`/${locale}/events/${slug}?registered=1`);
  if (sid && (await confirmStripeTicket(r.id, sid))) redirect(`/${locale}/events/${slug}?registered=1`);
  const stripe = !!getStripe(); const mock = await mockAllowed(); const payErr = await paymentsUnavailable(); const cur = r.currency as Currency;
  return (
    <main id="main"><section className="section"><div className="container" style={{ maxWidth: 560 }}>
      <div className="card">
        {!payErr && <><h1 style={{ fontSize: "var(--fs-2xl)" }}>{stripe ? t("waitStripe") : t("mockCheckout")}</h1>
        <p className="muted">{stripe ? t("waitStripeBody") : t("mockBody")}</p></>}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12 }}><span>{r.event.title} · {r.ticket === "member" ? t("member") : t("nonMember")}</span><b>{fmt2(r.amountCents, cur, locale)}</b></div>
        {payErr && <div className="alert alert-danger" role="alert"><div><b>{t("payUnavailable")}</b>{t("payUnavailableBody")}</div></div>}
        {!stripe && mock && <form action={completeMockTicket}><input type="hidden" name="r" value={r.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-accent btn-block">{t("payMock")} {fmt2(r.amountCents, cur, locale)}</button></form>}
        <p className="small muted" style={{ marginTop: 12 }}><a href={`/${locale}/events/${slug}`}>← {t("back")}</a></p>
      </div>
    </div></section></main>
  );
}
