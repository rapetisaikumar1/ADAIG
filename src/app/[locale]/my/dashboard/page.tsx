import { cancelOrder } from "../../join/actions";
import { membershipHousekeeping, renewalDue as isRenewalDue } from "@/lib/membership";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser, activeMembership } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { EventCard, eventView, isUnconfirmed } from "@/components/EventCard";
import type { Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { fmtDate, hasEnded, rejectionReasonText } from "../_shared/util";
import { memberMetadata } from "../_shared/meta";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("dashboard");

export default async function Dashboard({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ welcome?: string; already?: string; msg?: string; applied?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams;
  const u = await requireUser(locale); const t = await getTranslations("dash"); const tm = await getTranslations("member"); const te = await getTranslations("events"); const tj = await getTranslations("join"); const tp = await getTranslations("profile");
  await membershipHousekeeping(u.id); // lazy: unpaid orders expire (BUG-042), memberships past the renewal grace period lapse
  const now = new Date();
  const [act, pv, pp, rj, suggestedRaw, regsRaw, cpeAgg, cpeRecent, getTier] = await Promise.all([
    activeMembership(u.id),
    db.membership.findFirst({ where: { userId: u.id, status: "pending_verification" } }),
    db.membership.findFirst({ where: { userId: u.id, status: "pending" }, orderBy: { createdAt: "desc" } }),
    // Latest closed membership worth explaining: a rejected application, or a membership that lapsed (not renewed).
    db.membership.findFirst({ where: { userId: u.id, status: { in: ["rejected_verification", "lapsed"] } }, orderBy: { createdAt: "desc" } }),
    // Recommend confirmed events only: proposed/concept events (no date yet, no registrations) are left out.
    db.event.findMany({ where: { published: true, cancelledAt: null, startsAt: { gte: now }, registrations: { none: { userId: u.id } } }, orderBy: { startsAt: "asc" }, take: 12 }),
    // Same rule as My events: confirmed and awaiting-payment tickets for events that haven't ended yet.
    db.registration.findMany({ where: { userId: u.id, status: { in: ["confirmed", "pending_payment"] }, event: { startsAt: { gte: new Date(+now - 7 * 864e5) }, cancelledAt: null } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } } }),
    db.cpeEntry.aggregate({ where: { userId: u.id, status: "approved" }, _sum: { hours: true }, _count: true }),
    db.cpeEntry.findMany({ where: { userId: u.id, status: "approved" }, orderBy: { createdAt: "desc" }, take: 3 }),
    tierLookup(),
  ]);
  const m = act;
  const pendingVer = m ? null : pv;
  const pendingPay = m || pendingVer ? null : pp;
  const closed = m || pendingVer || pendingPay ? null : rj;
  const rejected = closed?.status === "rejected_verification" ? closed : null;
  const lapsed = closed?.status === "lapsed" ? closed : null;
  const suggested = suggestedRaw.filter((e) => !isUnconfirmed(e)).slice(0, 3);
  const regs = regsRaw.filter((r) => !hasEnded(r.event, now));
  const unpaid = regs.filter((r) => r.status === "pending_payment");
  // CPE: hours recorded (no certification cycle or target any more).
  const cpe = Math.round((cpeAgg._sum.hours ?? 0) * 100) / 100;
  const renewalDue = !!m && isRenewalDue(m, +now); // renewal date passed, still in the grace period (then the membership lapses)
  const daysLeft = m?.renewsAt ? Math.ceil((+m.renewsAt - +now) / 864e5) : null;
  const tierName = (id: string) => getTier(id)?.name[locale] ?? id;
  const L = (p: string) => `/${locale}${p}`;
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  // "Welcome back" is for returning visits; just after signing up or applying, plain "Welcome".
  const isNew = !!(sp.applied || sp.welcome) || +now - +u.createdAt < 864e5;
  const showApply = !m && !pendingVer && u.role !== "admin";
  const listed = u.directoryOptIn && !!m; // only active members appear in the directory
  const profileRows: [string, string | null][] = [
    [tj("org"), u.organisation || null],
    [tp("jobTitle"), u.jobTitle || null],
    [tp("language"), u.locale === "fr" ? "Français" : "English"],
    [t("emails"), u.marketingOptIn ? t("subscribed") : t("notSubscribed")],
  ];
  return (
    <div className="app"><MemberNav locale={locale} current="/my/dashboard" />
      <main id="main" className="app-main mbr">
        <div className="app-head"><div><p className="muted" style={{ margin: 0 }}>{tm(isNew ? "welcomeNew" : "welcome")}</p><h1>{u.name}</h1></div>
          {showApply ? <a className="btn btn-primary" href={L("/membership")}>{t("applyCta")}</a> : <a className="btn btn-primary" href={L("/events")}>{t("findEvents")}</a>}</div>
        <div className="mbr-alerts">
          {sp.welcome && m?.status === "active" && <div className="alert alert-success" role="status"><div><b>{t("welcome")}</b>{t("welcomeActive")}</div></div>}
          {rejected && <div className="alert alert-danger" role="alert"><div><b>{t("rejectedTitle")}</b>{rejectionReasonText(rejected.rejectionReason, (reason) => t("rejectedReasonText", { reason }), t("rejectedNoReason"))} {rejected.refundStatus === "refund_due" ? t("rejectedRefund") : rejected.paymentRef ? t("rejectedNoRefund") : t("rejectedContact")} <a href={L("/membership")}>{t("rejectedSwitch")}</a></div></div>}
          {m?.renewsAt && renewalDue && <div className="alert alert-warning" role="status"><div><b>{t("renewalDueTitle")}</b>{t("renewalDueBody", { tier: tierName(m.tierId), date: fmtDate(m.renewsAt, locale) })} <a href={L("/contact?topic=membership")}>{t("renewalContact")}</a></div></div>}
          {m?.renewsAt && !renewalDue && daysLeft !== null && daysLeft <= 60 && <div className="alert alert-warning" role="status"><div><b>{t("renewalTitle", { days: daysLeft })}</b>{t("renewalBody", { tier: tierName(m.tierId), date: fmtDate(m.renewsAt, locale) })} <a href={L("/my/billing")}>{t("viewMembership")}</a></div></div>}
          {sp.already && <div className="alert alert-info" role="status"><div>{t("alreadyMember")}</div></div>}
          {pendingPay && <div className="alert alert-info" role="status"><div><b>{tj("legacyOrderTitle", { tier: tierName(pendingPay.tierId) })}</b>{tj("legacyOrderBody")}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}><a className="btn btn-primary btn-sm" href={L(`/join?tier=${pendingPay.tierId}`)}>{tj("applyInstead")}</a>
            <form action={cancelOrder}><input type="hidden" name="m" value={pendingPay.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-secondary btn-sm">{tj("cancelOrder")}</button></form></div></div></div>}
          {["orderCancelled", "orderNotFound", "orderClosed", "alreadyPaid", "ticketNotFound"].includes(sp.msg ?? "") && <div className={`alert ${sp.msg === "orderCancelled" ? "alert-success" : "alert-info"}`} role="status"><div>{tj(`msg_${sp.msg}`)}</div></div>}
          {pendingVer && <div className={`alert ${sp.applied ? "alert-success" : "alert-info"}`} role="status"><div><b>{t(sp.applied ? "appliedTitle" : "pendingVerTitle")}</b>{t(pendingVer.paymentRef ? "pendingVerPaidBody" : "pendingVerBody", { tier: tierName(pendingVer.tierId) })}</div></div>}
          {lapsed && <div className="alert alert-warning" role="status"><div><b>{t("lapsedTitle")}</b>{t("lapsedBody", { tier: tierName(lapsed.tierId) })} <a href={L("/contact?topic=membership")}>{t("renewalContact")}</a></div></div>}
          {!m && !pendingVer && !pendingPay && !rejected && !lapsed && <div className="alert alert-info" role="status"><div><b>{t("none")}</b><a href={L("/membership")}>{t("joinNow")} →</a></div></div>}
          {unpaid.length > 0 && <div className="alert alert-info" role="status"><div>{t("unpaidTickets", { n: unpaid.length })} <a href={L("/my/events")}>{t("completePaymentLink")} →</a></div></div>}
        </div>
        <div className="grid g4 mbr-kpis">
          <a className="kpi mbr-kpi" href={L("/my/billing")}><div className="k">{t("membership")}</div><div className="v">{m ? tierName(m.tierId) : pendingVer ? tierName(pendingVer.tierId) : "—"}</div><div className={`d${m ? "" : " is-muted"}`}>{m?.renewsAt ? (renewalDue ? t("renewalDueD", { date: fmtDate(m.renewsAt, locale) }) : `${t("active")} ${fmtDate(m.renewsAt, locale)}`) : m ? t("activeNoDate") : pendingVer ? t("underReview") : lapsed ? t("lapsedD") : t("noneD")}</div></a>
          <div className="kpi"><div className="k">{t("cpe")}</div><div className="v">{t("hours", { n: cpe })}</div><div className="d is-muted">{t("cpeEntries", { n: cpeAgg._count })}</div></div>
          <a className="kpi mbr-kpi" href={L("/my/events")}><div className="k">{t("upcoming")}</div><div className="v">{regs.length}</div><div className={`d${regs[0] ? "" : " is-muted"}`}>{unpaid.length ? t("awaitingPayN", { n: unpaid.length }) : regs[0] ? (eventView(regs[0].event, locale).planned ? te("dateTbc") : t("nextOn", { date: fmtDate(regs[0].event.startsAt, locale, false) })) : "—"}</div></a>
          <a className="kpi mbr-kpi" href={L("/my/profile")}><div className="k">{t("directory")}</div><div className="v">{listed ? t("listed") : t("hidden")}</div><div className="d is-muted">{m ? t("dirChange") : t("dirMembersOnly")}</div></a>
        </div>
        <div className="grid g2 mbr-cards">
          <section className="card" aria-labelledby="h-cpe"><h2 id="h-cpe" style={h2}>{t("cpeCard")}</h2>
            <p className="small">{t("cpeTotal", { n: cpe })}</p>
            <h3 className="mbr-sub">{t("cpeRecent")}</h3>
            {cpeRecent.length ? <ul className="mbr-list">{cpeRecent.map((c) => <li key={c.id}><span>{c.title}</span><span className="mbr-meta">{t("hours", { n: c.hours })}</span></li>)}</ul> : <div className="mbr-empty mbr-empty-sm"><p>{t("cpeNone")}</p></div>}
            <p className="small muted mbr-foot">{t("cpeNote")}</p>
          </section>
          <section className="card" aria-labelledby="h-next"><h2 id="h-next" style={h2}>{t("nextEvents")}</h2>
            {regs.length ? <div className="mbr-stack">{regs.slice(0, 2).map((r) => (
              <div key={r.id} style={{ display: "grid", gap: 6 }}>
                <EventCard e={r.event} locale={locale} membersFreeLabel={te("membersFree")} />
                {r.status === "pending_payment" && <p className="small" style={{ margin: 0 }}><span className="badge badge-amber">{tm("eventsPage.pendingPay")}</span> <a href={L(`/events/${r.event.slug}`)}>{te("completePayment")} →</a></p>}
              </div>
            ))}</div> : <div className="mbr-empty mbr-empty-sm"><p>{t("noEvents")}</p></div>}
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
