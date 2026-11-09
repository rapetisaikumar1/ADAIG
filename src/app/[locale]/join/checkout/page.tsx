import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getStripe, mockAllowed, paymentsUnavailable } from "@/lib/stripe";
import { getTier, fmt2, currencies, type Currency, type Locale } from "@/config/site";
import { completeMockPayment, confirmStripe, cancelOrder } from "../actions";
import { expireUnpaid } from "@/lib/membership";

export default async function Checkout({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ m?: string; sid?: string }> }) {
  const { locale } = await params; setRequestLocale(locale); const te = await getTranslations("events"); const tj = await getTranslations("join");
  const { m: id, sid } = await searchParams;
  const s = await auth(); if (!s?.user) redirect(`/${locale}/login`);
  await expireUnpaid(s.user.id);
  const m = id ? await db.membership.findUnique({ where: { id } }) : null;
  if (!m || m.userId !== s.user.id) redirect(`/${locale}/my/dashboard?msg=orderNotFound`);
  if (m.status === "pending" && !(currencies as readonly string[]).includes(m.currency)) redirect(`/${locale}/my/dashboard?msg=orderClosed`);
  if (m.status !== "pending" && m.status !== "active" && m.status !== "pending_verification") redirect(`/${locale}/my/dashboard?msg=orderClosed`);
  if (m.status === "active" || m.status === "pending_verification") redirect(`/${locale}/my/dashboard?welcome=1`);
  if (sid && (await confirmStripe(m.id, sid))) redirect(`/${locale}/my/dashboard?welcome=1`);
  const tier = getTier(m.tierId)!; const cur = m.currency as Currency; const stripe = !!getStripe(); const mock = await mockAllowed(); const payErr = await paymentsUnavailable();
  return (
    <main id="main"><section className="section"><div className="container" style={{ maxWidth: 560 }}>
      <ol className="steps" aria-label="Progress"><li className="done">1. Tier</li><li className="done">2. Details</li><li aria-current="step">3. Payment</li></ol>
      <div className="card">
        {!payErr && <><h1 style={{ fontSize: "var(--fs-2xl)" }}>{stripe ? te("waitStripe") : tj("checkoutTitle")}</h1>
        <p className="muted">{stripe ? te("waitStripeBody") : te("mockBody")}</p></>}
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>{tier.name[locale]} · {te("oneYear")}</span><b>{fmt2(m.amountCents, cur, locale)}</b></div>
        {m.taxCents > 0 && <div style={{ display: "flex", justifyContent: "space-between" }} className="muted"><span>Tax</span><span>{fmt2(m.taxCents, cur, locale)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><b>Total</b><b>{fmt2(m.amountCents + m.taxCents, cur, locale)}</b></div>
        {payErr && <div className="alert alert-danger" role="alert"><div><b>{te("payUnavailable")}</b>{te("payUnavailableBody")}</div></div>}
        {!stripe && mock && <form action={completeMockPayment}><input type="hidden" name="m" value={m.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-accent btn-block">{te("payMock")} {fmt2(m.amountCents + m.taxCents, cur, locale)}</button></form>}
      <form action={cancelOrder} style={{ marginTop: 12 }}><input type="hidden" name="m" value={m.id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="from" value="join" /><button className="btn btn-secondary btn-sm">{tj("cancelOrder")}</button> <a className="small" href={`/${locale}/join?tier=${m.tierId}&cur=${m.currency}`}>{tj("changeOrder")}</a></form>
      </div>
    </div></section></main>
  );
}
