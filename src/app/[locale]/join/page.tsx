import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { mockAllowed } from "@/lib/stripe";
import { tiers, currencies, defaultCurrency, type Currency, type Locale } from "@/config/site";
import { JoinForm } from "./JoinForm";
import { cancelOrder } from "./actions";
import { expireUnpaid } from "@/lib/membership";
import { getTier as tierOf, fmt2 } from "@/config/site";

export default async function Join({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ tier?: string; cur?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams; const t = await getTranslations("join"); const tm = await getTranslations("membership");
  const tier = tiers.find((x) => x.id === sp.tier)?.id ?? (tiers.find((x) => x.featured) ?? tiers[0]).id;
  const cur = (currencies.includes(sp.cur as Currency) ? sp.cur : defaultCurrency) as Currency;
  const s = await auth(); const u = s?.user?.id ? await db.user.findUnique({ where: { id: s.user.id } }) : null;
  // BUG-033: already a member / application in progress → dashboard
  if (u) await expireUnpaid(u.id);
  const open = u ? await db.membership.findFirst({ where: { userId: u.id, status: { in: ["pending", "pending_verification", "active"] } }, orderBy: { createdAt: "desc" } }) : null;
  if (open && open.status !== "pending") redirect(`/${locale}/my/dashboard?already=1`);
  const unpaid = open; // BUG-042: unpaid order → continue, cancel, or pick another tier/currency below (replaces it)
  const msg = sp.msg;
  const [first, ...rest] = (u?.name ?? "").split(" ");
  return (
    <main id="main">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{tm("home")}</a></li><li><a href={`/${locale}/membership`}>{tm("eyebrow")}</a></li><li aria-current="page">{t("title")}</li></ol></nav>
        <span className="eyebrow">{tm("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section">
        {(msg === "orderCancelled" || msg === "orderNotFound") && <div className="container"><div className={`alert ${msg === "orderCancelled" ? "alert-success" : "alert-info"}`} role="status" style={{ marginBottom: 16 }}><div>{t(`msg_${msg}`)}</div></div></div>}
        {unpaid && <div className="container"><div className="alert alert-warning" role="status" style={{ marginBottom: 16 }}><div>
          <b>{t("unpaidTitle", { tier: tierOf(unpaid.tierId)?.name[locale] ?? unpaid.tierId, amount: fmt2(unpaid.amountCents, unpaid.currency as Currency, locale) })}</b> {t("unpaidBody")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}><a className="btn btn-accent btn-sm" href={`/${locale}/join/checkout?m=${unpaid.id}`}>{t("continuePayment")}</a>
          <form action={cancelOrder}><input type="hidden" name="m" value={unpaid.id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="from" value="join" /><button className="btn btn-secondary btn-sm">{t("cancelOrder")}</button></form></div>
        </div></div></div>}
        <JoinForm locale={locale} initialTier={tier} initialCur={cur} signedIn={!!u} mock={await mockAllowed()} defaults={{ first: u ? first : undefined, last: u ? rest.join(" ") : undefined, org: u?.organisation ?? undefined }} />
      </section>
    </main>
  );
}
