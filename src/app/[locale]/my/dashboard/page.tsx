import { cancelOrder } from "../../join/actions";
import { expireUnpaid } from "@/lib/membership";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser, activeMembership } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { EventCard, eventView, isUnconfirmed } from "@/components/EventCard";
import { cpeCycleTarget, type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { fmtDate } from "../_shared/util";
export const dynamic = "force-dynamic";

export default async function Dashboard({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ welcome?: string; already?: string; msg?: string; applied?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams;
  const u = await requireUser(locale); const t = await getTranslations("dash"); const tm = await getTranslations("member"); const te = await getTranslations("events"); const tj = await getTranslations("join"); const tp = await getTranslations("profile");
  await expireUnpaid(u.id); // BUG-042 lazy expiry
  const m = await activeMembership(u.id);
  const pendingVer = m ? null : await db.membership.findFirst({ where: { userId: u.id, status: "pending_verification" } });
  const pendingPay = m || pendingVer ? null : await db.membership.findFirst({ where: { userId: u.id, status: "pending" }, orderBy: { createdAt: "desc" } });
  const rejected = m || pendingVer || pendingPay ? null : await db.membership.findFirst({ where: { userId: u.id, status: "rejected_verification" }, orderBy: { createdAt: "desc" } });
  const myEventIds = (await db.registration.findMany({ where: { userId: u.id }, select: { eventId: true } })).map((r) => r.eventId);
  // Recommend confirmed events only: proposed/concept events (no date yet, no registrations) are left out.
  const suggested = (await db.event.findMany({ where: { published: true, cancelledAt: null, startsAt: { gte: new Date() }, id: { notIn: myEventIds } }, orderBy: { startsAt: "asc" }, take: 12 }))
    .filter((e) => !isUnconfirmed(e)).slice(0, 3);
  const regs = await db.registration.findMany({ where: { userId: u.id, status: "confirmed", event: { startsAt: { gte: new Date() }, cancelledAt: null } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } } });
  const cpe = (await db.cpeEntry.aggregate({ where: { userId: u.id, status: "approved" }, _sum: { hours: true } }))._sum.hours ?? 0;
  const cpeRecent = await db.cpeEntry.findMany({ where: { userId: u.id, status: "approved" }, orderBy: { createdAt: "desc" }, take: 3 });
  const pct = Math.min(100, Math.round((cpe / cpeCycleTarget) * 100));
  const daysLeft = m?.renewsAt ? Math.ceil((+m.renewsAt - Date.now()) / 864e5) : null;
  const getTier = await tierLookup(); const tierName = (id: string) => getTier(id)?.name[locale] ?? id;
  const L = (p: string) => `/${locale}${p}`;
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  const profileRows: [string, string | null][] = [
    [tj("org"), u.organisation || null],
    [tp("jobTitle"), u.jobTitle || null],
    [t("directory"), u.directoryOptIn ? t("listed") : t("hidden")],
    [t("emails"), u.marketingOptIn ? t("subscribed") : t("notSubscribed")],
  ];
  return (
    <div className="app"><MemberNav locale={locale} current="/my/dashboard" />
      <main id="main" className="app-main mbr">
        <div className="app-head"><div><p className="muted" style={{ margin: 0 }}>{tm("welcome")}</p><h1>{u.name}</h1></div><a className="btn btn-primary" href={L("/events")}>{t("findEvents")}</a></div>
        <div className="mbr-alerts">
          {sp.welcome && m?.status === "active" && <div className="alert alert-success" role="status"><div><b>{t("welcome")}</b>{t("welcomeActive")}</div></div>}
          {rejected && <div className="alert alert-danger" role="alert"><div><b>{t("rejectedTitle")}</b>{t("rejectedReason")}: {rejected.rejectionReason ?? "—"}. {rejected.refundStatus === "refund_due" ? t("rejectedRefund") : rejected.paymentRef ? t("rejectedNoRefund") : t("rejectedContact")} <a href={L("/membership")}>{t("rejectedSwitch")}</a></div></div>}
          {m && m.renewsAt && daysLeft !== null && daysLeft >= 0 && daysLeft <= 60 && <div className="alert alert-warning" role="status"><div><b>{t("renewalTitle", { days: daysLeft })}</b>{t("renewalBody", { tier: tierName(m.tierId), date: fmtDate(m.renewsAt, locale) })} <a href={L("/my/billing")}>{t("viewMembership")}</a></div></div>}
          {sp.already && <div className="alert alert-info" role="status"><div>{t("alreadyMember")}</div></div>}
          {pendingPay && <div className="alert alert-info" role="status"><div><b>{tj("legacyOrderTitle", { tier: tierName(pendingPay.tierId) })}</b>{tj("legacyOrderBody")}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}><a className="btn btn-accent btn-sm" href={L(`/join?tier=${pendingPay.tierId}`)}>{tj("applyInstead")}</a>
            <form action={cancelOrder}><input type="hidden" name="m" value={pendingPay.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-secondary btn-sm">{tj("cancelOrder")}</button></form></div></div></div>}
          {["orderCancelled", "orderNotFound", "orderClosed", "alreadyPaid", "ticketNotFound"].includes(sp.msg ?? "") && <div className={`alert ${sp.msg === "orderCancelled" ? "alert-success" : "alert-info"}`} role="status"><div>{tj(`msg_${sp.msg}`)}</div></div>}
          {pendingVer && <div className={`alert ${sp.applied ? "alert-success" : "alert-info"}`} role="status"><div><b>{t(sp.applied ? "appliedTitle" : "pendingVerTitle")}</b>{t(pendingVer.paymentRef ? "pendingVerPaidBody" : "pendingVerBody", { tier: tierName(pendingVer.tierId) })}</div></div>}
          {!m && !pendingVer && !pendingPay && !rejected && <div className="alert alert-info" role="status"><div><b>{t("none")}</b><a href={L("/membership")}>{t("joinNow")} →</a></div></div>}
        </div>
        <div className="grid g4 mbr-kpis">
          <a className="kpi mbr-kpi" href={L("/my/billing")}><div className="k">{t("membership")}</div><div className="v">{m ? tierName(m.tierId) : pendingVer ? tierName(pendingVer.tierId) : "—"}</div><div className={`d${m ? "" : " is-muted"}`}>{m?.renewsAt ? `${t("active")} ${fmtDate(m.renewsAt, locale)}` : pendingVer ? t("underReview") : t("noneD")}</div></a>
          <div className="kpi"><div className="k">{t("cpe")}</div><div className="v">{cpe} / {cpeCycleTarget}</div><div className="d">{pct}%</div></div>
          <a className="kpi mbr-kpi" href={L("/my/events")}><div className="k">{t("upcoming")}</div><div className="v">{regs.length}</div><div className={`d${regs[0] ? "" : " is-muted"}`}>{regs[0] ? t("nextOn", { date: fmtDate(regs[0].event.startsAt, locale, false) }) : "—"}</div></a>
          <a className="kpi mbr-kpi" href={L("/my/profile")}><div className="k">{t("directory")}</div><div className="v">{u.directoryOptIn ? t("listed") : t("hidden")}</div><div className="d is-muted">{t("dirChange")}</div></a>
        </div>
        <div className="grid g2 mbr-cards">
          <section className="card" aria-labelledby="h-cpe"><h2 id="h-cpe" style={h2}>{t("cpeProgress")}</h2>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-labelledby="h-cpe"><span style={{ width: `${pct}%` }} /></div>
            <p className="small">{cpe >= cpeCycleTarget ? t("cpeDone") : t("remainingN", { n: Math.max(0, cpeCycleTarget - cpe) })}</p>
            <h3 className="mbr-sub">{t("cpeRecent")}</h3>
            {cpeRecent.length ? <ul className="mbr-list">{cpeRecent.map((c) => <li key={c.id}><span>{c.title}</span><span className="mbr-meta">{t("hours", { n: c.hours })}</span></li>)}</ul> : <div className="mbr-empty mbr-empty-sm"><p>{t("cpeNone")}</p></div>}
            <p className="small muted mbr-foot">{t("cpeNote")}</p>
          </section>
          <section className="card" aria-labelledby="h-next"><h2 id="h-next" style={h2}>{t("nextEvents")}</h2>
            {regs.length ? <div className="mbr-stack">{regs.slice(0, 2).map((r) => <EventCard key={r.id} e={r.event} locale={locale} membersFreeLabel={te("membersFree")} />)}</div> : <div className="mbr-empty mbr-empty-sm"><p>{t("noEvents")}</p></div>}
            <p className="small mbr-foot"><a href={L("/my/events")}>{t("tickets")}</a></p>
          </section>
          <section className="card" aria-labelledby="h-rec"><h2 id="h-rec" style={h2}>{t("recommended")}</h2>
            <p className="small muted">{t("recWhy")}</p>
            {suggested.length ? <ul className="mbr-list">{suggested.map((e) => <li key={e.id}><a href={L(`/events/${e.slug}`)}>{eventView(e, locale).title}</a><span className="mbr-meta">{fmtDate(e.startsAt, locale, false)}</span></li>)}</ul> : <div className="mbr-empty mbr-empty-sm"><p>{t("noSuggestions")}</p></div>}
            <p className="small mbr-foot"><a href={L("/resources")}>{t("recResources")} →</a></p>
          </section>
          <section className="card" aria-labelledby="h-prof"><h2 id="h-prof" style={h2}>{t("profileCard")}</h2>
            <dl className="mbr-dl">{profileRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v ? undefined : "muted"}>{v ?? t("notSet")}</dd></div>)}</dl>
            <p className="small mbr-foot"><a href={L("/my/profile")}>{t("editProfile")}</a></p>
          </section>
        </div>
      </main>
    </div>
  );
}
