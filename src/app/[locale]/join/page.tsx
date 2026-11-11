import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { type Locale } from "@/config/site";
import { getTiers, tierLookup, directoryOptInDefault } from "@/lib/settings";
import { JoinForm } from "./JoinForm";
import { Icon } from "@/components/ui/Icon";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { cancelOrder } from "./actions";
import { expireUnpaid } from "@/lib/membership";

export default async function Join({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ tier?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams; const t = await getTranslations("join"); const tm = await getTranslations("membership");
  // Tiers and defaults are admin-editable (Admin → Settings) and passed to the client form as props.
  const [tiers, tierOf, dirDefault] = await Promise.all([getTiers(), tierLookup(), directoryOptInDefault()]);
  const tier = tiers.find((x) => x.id === sp.tier)?.id ?? (tiers.find((x) => x.featured) ?? tiers[0]).id;
  const formTiers = tiers.map((x) => ({ id: x.id, name: x.name, description: x.description, requiresVerification: x.requiresVerification }));
  const s = await auth(); const u = s?.user?.id ? await db.user.findUnique({ where: { id: s.user.id } }) : null;
  // Q4 (round 7): an Admin Portal account can't apply for membership (startJoin refuses it too): a notice instead of the form.
  if (u?.role === "admin") return (
    <main id="main" tabIndex={-1} className="join-page">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{tm("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container">
        <div className="alert alert-info join-notice" role="status"><Icon name="info" /><div>{t("err_adminAccount")}</div></div>
      </div></section>
    </main>
  );
  // BUG-033: already a member / application in progress → dashboard
  if (u) await expireUnpaid(u.id);
  const open = u ? await db.membership.findFirst({ where: { userId: u.id, status: { in: ["pending", "pending_verification", "active"] } }, orderBy: { createdAt: "desc" } }) : null;
  if (open && open.status !== "pending") redirect(`/${locale}/my/billing?already=1`);
  const legacyOrder = open; // unpaid order from the old payment flow: can be cancelled; submitting the application replaces it
  const msg = sp.msg;
  const [first, ...rest] = (u?.name ?? "").split(" ");
  return (
    <main id="main" tabIndex={-1} className="join-page">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{tm("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section">
        {(msg === "orderCancelled" || msg === "orderNotFound") && <div className="container"><FocusOnLoad><div className={`alert join-notice ${msg === "orderCancelled" ? "alert-success" : "alert-info"}`} role="status"><Icon name={msg === "orderCancelled" ? "check-circle" : "info"} /><div>{t(`msg_${msg}`)}</div></div></FocusOnLoad></div>}
        {legacyOrder && <div className="container"><div className="alert alert-info join-notice" role="status"><Icon name="info" /><div>
          <b>{t("legacyOrderTitle", { tier: tierOf(legacyOrder.tierId)?.name[locale] ?? legacyOrder.tierId })}</b> {t("legacyOrderBody")}
          <form action={cancelOrder}><input type="hidden" name="m" value={legacyOrder.id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="from" value="join" /><button className="btn btn-secondary btn-sm">{t("cancelOrder")}</button></form>
        </div></div></div>}
        <JoinForm locale={locale} tiers={formTiers} directoryOptInDefault={dirDefault} initialTier={tier} signedIn={!!u} defaults={{ first: u ? first : undefined, last: u ? rest.join(" ") : undefined, org: u?.organisation ?? undefined }} />
      </section>
    </main>
  );
}
