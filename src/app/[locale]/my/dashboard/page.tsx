import { cancelOrder } from "../../join/actions";
import { expireUnpaid } from "@/lib/membership";
import { unpaidOrderTtlHours } from "@/config/site";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser, activeMembership } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { EventCard } from "@/components/EventCard";
import { getTier, cpeCycleTarget, type Locale } from "@/config/site";
export const dynamic = "force-dynamic";

export default async function Dashboard({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ welcome?: string; already?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const t = await getTranslations("dash"); const tm = await getTranslations("member"); const te = await getTranslations("events"); const tj = await getTranslations("join");
  await expireUnpaid(u.id); // BUG-042 lazy expiry
  const m = await activeMembership(u.id);
  const pendingVer = m ? null : await db.membership.findFirst({ where: { userId: u.id, status: "pending_verification" } });
  const pendingPay = m || pendingVer ? null : await db.membership.findFirst({ where: { userId: u.id, status: "pending" }, orderBy: { createdAt: "desc" } });
  const rejected = m || pendingVer || pendingPay ? null : await db.membership.findFirst({ where: { userId: u.id, status: "rejected_verification" }, orderBy: { createdAt: "desc" } });
  const myEventIds = (await db.registration.findMany({ where: { userId: u.id }, select: { eventId: true } })).map((r) => r.eventId);
  const suggested = await db.event.findMany({ where: { published: true, startsAt: { gte: new Date() }, id: { notIn: myEventIds } }, orderBy: { startsAt: "asc" }, take: 2 });
  const regs = await db.registration.findMany({ where: { userId: u.id, status: "confirmed", event: { startsAt: { gte: new Date() } } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } } });
  const cpe = (await db.cpeEntry.aggregate({ where: { userId: u.id, status: "approved" }, _sum: { hours: true } }))._sum.hours ?? 0;
  const pct = Math.min(100, Math.round((cpe / cpeCycleTarget) * 100));
  const dl = locale === "fr" ? "fr-FR" : "en-US";
  const daysLeft = m?.renewsAt ? Math.ceil((+m.renewsAt - Date.now()) / 864e5) : null;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/dashboard" />
      <main id="main" className="app-main">
        <div className="app-head"><div><p className="muted" style={{ margin: 0 }}>{tm("welcome")}</p><h1>{u.name}</h1></div><a className="btn btn-highlight" href={`/${locale}/events`}>{t("findEvents")}</a></div>
        {(await searchParams).welcome && m?.status === "active" && <div className="alert alert-success" role="status" style={{ marginBottom: 24 }}><div><b>{t("welcome")}</b>{t("welcomeActive")}</div></div>}
        {rejected && <div className="alert alert-danger" role="alert" style={{ marginBottom: 24 }}><div><b>{t("rejectedTitle")}</b>{t("rejectedReason")}: {rejected.rejectionReason ?? "—"}. {rejected.refundStatus === "refund_due" ? t("rejectedRefund") : t("rejectedNoRefund")} <a href={`/${locale}/membership`}>{t("rejectedSwitch")}</a></div></div>}
        {m && daysLeft !== null && daysLeft <= 60 && <div className="alert alert-warning" style={{ marginBottom: 24 }}><div><b>{t("renewal")}: {daysLeft} d</b>{m.autoRenew ? t("autoOn") : ""} <a href={`/${locale}/my/billing`}>{t("manage")}</a></div></div>}
        {(await searchParams).already && <div className="alert alert-info" role="status" style={{ marginBottom: 24 }}><div>{t("alreadyMember")}</div></div>}
        {pendingPay && <div className="alert alert-warning" role="status" style={{ marginBottom: 24 }}><div><b>{t("pendingPayTitle")}</b><a href={`/${locale}/join/checkout?m=${pendingPay.id}`}>{t("completePayment")}</a>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}><a className="btn btn-secondary btn-sm" href={`/${locale}/join?tier=${pendingPay.tierId}&cur=${pendingPay.currency}`}>{tj("changeOrder")}</a>
          <form action={cancelOrder}><input type="hidden" name="m" value={pendingPay.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-secondary btn-sm">{tj("cancelOrder")}</button></form></div>
          <span className="small muted">{tj("expiresNote", { hours: unpaidOrderTtlHours() })}</span></div></div>}
        {["orderCancelled", "orderNotFound", "orderClosed", "alreadyPaid", "ticketNotFound"].includes((await searchParams).msg ?? "") && <div className={`alert ${(await searchParams).msg === "orderCancelled" ? "alert-success" : "alert-info"}`} role="status" style={{ marginBottom: 24 }}><div>{tj(`msg_${(await searchParams).msg}`)}</div></div>}
        {pendingVer && <div className="alert alert-warning" role="status" style={{ marginBottom: 24 }}><div><b>{t("pendingVerTitle")}</b>{t("pendingVerBody")}</div></div>}
        {!m && !pendingVer && !pendingPay && !rejected && <div className="alert alert-info" style={{ marginBottom: 24 }}><div><b>{t("none")}</b><a href={`/${locale}/membership`}>{t("joinNow")} →</a></div></div>}
        <div className="grid g4" style={{ marginBottom: 24 }}>
          <div className="kpi"><div className="k">{t("membership")}</div><div className="v">{m ? getTier(m.tierId)?.name[locale] : "Guest"}</div><div className="d">{m?.renewsAt ? `${t("active")} ${m.renewsAt.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric" })}` : "—"}</div></div>
          <div className="kpi"><div className="k">{t("cpe")}</div><div className="v">{cpe} / {cpeCycleTarget}</div><div className="d">{pct}%</div></div>
          <div className="kpi"><div className="k">{t("upcoming")}</div><div className="v">{regs.length}</div><div className="d">{regs[0] ? `${t("next")}: ${regs[0].event.startsAt.toLocaleDateString(dl, { day: "numeric", month: "short" })}` : "—"}</div></div>
          <div className="kpi"><div className="k">{t("badges")}</div><div className="v">—</div><div className="d">{t("badgesSoon")}</div></div>
        </div>
        <div className="grid g2">
          <section className="card"><h2 style={{ fontSize: "var(--fs-lg)" }}>{t("cpeProgress")}</h2><div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("cpeProgress")}><span style={{ width: `${pct}%` }} /></div><p className="small">{Math.max(0, cpeCycleTarget - cpe)} {t("remaining")}</p><a href={`/${locale}/my/credentials`} className="small">{t("logCpe")}</a></section>
          <section className="card"><h2 style={{ fontSize: "var(--fs-lg)" }}>{t("nextEvents")}</h2>{regs.length ? regs.slice(0, 2).map((r) => <EventCard key={r.id} e={r.event} locale={locale} membersFreeLabel={te("membersFree")} />) : <p className="small muted">{t("noEvents")}</p>}<a href={`/${locale}/my/events`} className="small">{t("tickets")}</a></section>
          <section className="card"><h2 style={{ fontSize: "var(--fs-lg)" }}>{t("recommended")}</h2><p className="small"><span className="badge">{t("recBadge")}</span> {t("recWhy")}</p>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {suggested.map((e) => <li key={e.id}><a href={`/${locale}/events/${e.slug}`}>{locale === "fr" && e.titleFr ? e.titleFr : e.title}</a></li>)}
              <li><a href={`/${locale}/learning`}>{t("recLearning")}</a></li>
              <li><a href={`/${locale}/resources`}>{t("recResources")}</a></li>
            </ul></section>
        </div>
      </main>
    </div>
  );
}
