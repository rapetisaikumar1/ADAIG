import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { renewalDue as isRenewalDue } from "@/lib/membership";
import { cancelOrder } from "../../join/actions";
import { MemberNav } from "@/components/AppShell";
import { eventView } from "@/components/EventCard";
import { fmt, type Currency, type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { fmtDate, etDayNumber, hasEnded, rejectionReasonText } from "../_shared/util";
import { memberMetadata } from "../_shared/meta";
import { membershipState, membershipDates, statusTone } from "../_shared/membership";
import { PageHead, Notice, SectionHead } from "../_shared/ui";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Avatar, EmptyState, Status } from "@/components/ui/Facet";
import { Icon } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("billing");

type Search = { welcome?: string; already?: string; msg?: string; applied?: string };
const MESSAGES = ["orderCancelled", "orderNotFound", "orderClosed", "alreadyPaid", "ticketNotFound"];

/**
 * My membership: the member home (sign-in, join and the old /my/dashboard all land here). Membership status and the notices a
 * member must see (application received, welcome, renewal, lapsed, rejected, order/ticket messages), a compact activity summary
 * (next event, CPE hours) and paid event tickets. Membership fees are not taken online: the ADAIG team invoices members directly.
 */
export default async function MyMembership({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<Search> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams;
  const u = await requireUser(locale);
  const t = await getTranslations("member.billingPage"); const tm = await getTranslations("member"); const td = await getTranslations("dash"); const tj = await getTranslations("join"); const te = await getTranslations("events"); const tev = await getTranslations("member.eventsPage");
  const now = new Date();
  // Status card + notices: one shared reading (also used by Profile & privacy), housekeeping included.
  const { act, pendingVer, pendingPay, closed, m, status } = await membershipState(u.id);
  const [regsRaw, cpeAgg, paidTickets, getTier] = await Promise.all([
    // Same rule as My events: confirmed and awaiting-payment tickets for events that haven't ended yet.
    db.registration.findMany({ where: { userId: u.id, status: { in: ["confirmed", "pending_payment"] }, event: { startsAt: { gte: new Date(+now - 7 * 864e5) }, cancelledAt: null } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } } }),
    db.cpeEntry.aggregate({ where: { userId: u.id, status: "approved" }, _sum: { hours: true }, _count: true }),
    db.registration.findMany({ where: { userId: u.id, status: "confirmed", amountCents: { gt: 0 } }, include: { event: true }, orderBy: { event: { startsAt: "desc" } } }),
    tierLookup(),
  ]);
  const rejected = closed?.status === "rejected_verification" ? closed : null;
  const lapsed = closed?.status === "lapsed" ? closed : null;
  const regs = regsRaw.filter((r) => !hasEnded(r.event, now));
  const unpaid = regs.filter((r) => r.status === "pending_payment");
  const next = regs[0] ? eventView(regs[0].event, locale) : null;
  const cpe = Math.round((cpeAgg._sum.hours ?? 0) * 100) / 100; // CPE: hours recorded (no certification cycle or target)
  const tierName = (id: string) => getTier(id)?.name[locale] ?? id;
  const L = (p: string) => `/${locale}${p}`;
  // Renewal date passed (grace period before the membership lapses): the team contacts the member, nothing is paid online.
  const renewalDue = !!act && isRenewalDue(act, +now);
  // Calendar days in ADAIG's time zone (ET): Nov 11 → Dec 8 is 27 days, whatever the time of day (QA-PORTALS-5).
  const daysLeft = act?.renewsAt ? etDayNumber(act.renewsAt) - etDayNumber(now) : null;
  // "Welcome back" is for returning visits; just after signing up or applying, plain "Welcome".
  const isNew = !!(sp.applied || sp.welcome) || +now - +u.createdAt < 864e5;
  // Presentation only below. The status chip on the card uses the one status component (DESIGN_R5 §6.4).
  const tone = statusTone(status);
  // The tier is the card's title; the dates are its facts (labels per status: a lapsed membership is not "Member since").
  const facts = m ? membershipDates(m, (k) => t(k), locale, now) : [];
  // "How joining works" steps reuse the join page's "What happens next" copy; for a pending application step 1 is done.
  const steps = [
    { title: tj("next1Title"), body: pendingVer ? `${t("applied")} ${fmtDate(pendingVer.createdAt, locale)}` : null },
    { title: tj("next2Title"), body: tj("next2") },
    { title: tj("next3Title"), body: tj("next3") },
  ];
  // Order (coordinator D3): notices answering what the member just did (sign-up, application, repeat join, order links) come
  // first and take focus (D7); then the standing notices that need action (rejected, renewal due/soon, lapsed, legacy order,
  // unpaid tickets) — all above the card. Purely informational next steps (application under review + stepper) follow the card.
  const flash = [
    sp.welcome && act && <Notice key="w" tone="success" title={td("welcome")}>{td("welcomeActive")}</Notice>,
    pendingVer && sp.applied && <Notice key="a" tone="success" title={td("appliedTitle")}>{td(pendingVer.paymentRef ? "pendingVerPaidBody" : "pendingVerBody", { tier: tierName(pendingVer.tierId) })}</Notice>,
    sp.already && <Notice key="al" tone="info">{td("alreadyMember")}</Notice>,
    MESSAGES.includes(sp.msg ?? "") && <Notice key="m" tone={sp.msg === "orderCancelled" ? "success" : "info"}>{tj(`msg_${sp.msg}`)}</Notice>,
  ].filter(Boolean);
  const info = pendingVer && !sp.applied ? <Notice tone="info" title={td("pendingVerTitle")}>{td(pendingVer.paymentRef ? "pendingVerPaidBody" : "pendingVerBody", { tier: tierName(pendingVer.tierId) })}</Notice> : null;
  const required = [
    rejected && <Notice key="r" tone="danger" role="alert" title={td("rejectedTitle")}>{rejectionReasonText(rejected.rejectionReason, (reason) => td("rejectedReasonText", { reason }), td("rejectedNoReason"))} {rejected.refundStatus === "refund_due" ? td("rejectedRefund") : rejected.paymentRef ? td("rejectedNoRefund") : td("rejectedContact")} <a href={L("/membership")}>{td("rejectedSwitch")}</a></Notice>,
    act?.renewsAt && renewalDue && <Notice key="rd" tone="warning" title={td("renewalDueTitle")}>{td("renewalDueBody", { tier: tierName(act.tierId), date: fmtDate(act.renewsAt, locale) })} <a href={L("/contact?topic=membership")}>{td("renewalContact")}</a></Notice>,
    act?.renewsAt && !renewalDue && daysLeft !== null && daysLeft <= 60 && <Notice key="rn" tone="warning" title={td("renewalTitle", { days: daysLeft })}>{td("renewalBody", { tier: tierName(act.tierId), date: fmtDate(act.renewsAt, locale) })}</Notice>,
    lapsed && <Notice key="l" tone="warning" title={td("lapsedTitle")}>{td("lapsedBody", { tier: tierName(lapsed.tierId) })} <a href={L("/contact?topic=membership")}>{td("renewalContact")}</a></Notice>,
    pendingPay && <Notice key="pp" tone="info" title={tj("legacyOrderTitle", { tier: tierName(pendingPay.tierId) })}>{tj("legacyOrderBody")}
      <div className="mbr-alert-actions"><a className="btn btn-primary btn-sm" href={L(`/join?tier=${pendingPay.tierId}`)}>{tj("applyInstead")}</a>
      <form action={cancelOrder}><input type="hidden" name="m" value={pendingPay.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-secondary btn-sm">{tj("cancelOrder")}</button></form></div></Notice>,
    unpaid.length > 0 && <Notice key="u" tone="info">{td("unpaidTickets", { n: unpaid.length })} <a href={L("/my/events")}>{td("completePaymentLink")} →</a></Notice>,
  ].filter(Boolean);
  return (
    <div className="app"><MemberNav locale={locale} current="/my/billing" />
      <main id="main" tabIndex={-1} className="app-main mbr mbr-home">
        <PageHead title={t("title")} kicker={<>{tm(isNew ? "welcomeNew" : "welcome")} {u.name}</>} media={<Avatar name={u.name} />} />
        {flash.length > 0 && <FocusOnLoad className="mbr-alerts-focus"><div className="mbr-alerts">{flash}</div></FocusOnLoad>}
        {required.length > 0 && <div className="mbr-alerts">{required}</div>}

        <div className="mbr-top">
          {status === "none" ? (
            // No membership: nothing to invoice or renew yet. The card becomes the "how joining works" onboarding panel.
            <section className="mcard mbr-mcard is-none" aria-labelledby="h-status">
              <div className="mcard-col">
                <h2 id="h-status" className="eyebrow">{t("statusTitle")}</h2>
                <p className="mcard-tier">{t("st_none")}</p>
                <p className="mcard-body">{t("noneBody")}</p>
                <div className="mcard-actions"><a className="btn btn-highlight" href={L("/join")}>{t("apply")}</a><a className="link-arrow" href={L("/membership")}>{t("compare")}</a></div>
              </div>
              <div className="mcard-how">
                <h3 id="h-how">{t("howTitle")}</h3>
                <p>{t("howBody")}</p>
                <ol className="mbr-steps is-compact">{steps.map((s) => <li key={s.title}><b>{s.title}</b></li>)}</ol>
              </div>
            </section>
          ) : (<>
            {/* The membership card: the portal's one navy element (facet cut + corner art come from shell.css .mcard). */}
            <section className="mcard mbr-mcard" aria-labelledby="h-status">
              <h2 id="h-status" className="eyebrow">{t("statusTitle")}</h2>
              <div className="mcard-title">
                <p className="mcard-tier"><span className="sr-only">{t("srLabel", { label: t("tier") })} </span>{m ? tierName(m.tierId) : ""}</p>
                <Status tone={tone}><span className="sr-only">{t("srLabel", { label: t("status") })} </span>{t(`st_${status}`)}</Status>
              </div>
              {facts.length > 0 && <dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
              {status !== "pending_verification" && <p className="mcard-foot"><a className={status === "active" ? "mcard-quiet" : "link-arrow"} href={L("/membership")}>{t("compare")}</a></p>}
            </section>
            <section className="panel mbr-panel" aria-labelledby="h-inv">
              <span className="icon-tile" aria-hidden="true"><Icon name={status === "rejected_verification" ? "mail" : "document"} /></span>
              <h2 id="h-inv">{t(status === "rejected_verification" ? "questionsTitle" : "invoicingTitle")}</h2>
              {status !== "rejected_verification" && <p>{t("invoicingBody")}</p>}
              <p className="mbr-help">{t("invoicingHelp")}</p>
              <div className="mbr-panel-foot"><a className="btn btn-secondary" href={L("/contact?topic=membership")}><Icon name="mail" size={18} />{t("contact")}</a></div>
            </section>
          </>)}
        </div>

        {pendingVer && (
          <div className="mbr-next">
            {info}
            {pendingVer && (
              <section className="panel mbr-panel mbr-progress" aria-labelledby="h-next">
                <h2 id="h-next">{tj("nextTitle")}</h2>
                <ol className="mbr-steps">{steps.map((s, i) => (
                  <li key={s.title} className={i === 0 ? "is-done" : i === 1 ? "is-current" : undefined} aria-current={i === 1 ? "step" : undefined}>
                    <b>{s.title}</b>{s.body && <span>{s.body}</span>}
                  </li>
                ))}</ol>
              </section>
            )}
          </div>
        )}

        {/* Compact activity summary (formerly on the dashboard): real counts only — next registration and CPE hours. */}
        <section className="mbr-section" aria-labelledby="h-act">
          <SectionHead id="h-act" title={t("activityTitle")} />
          {!act && regs.length === 0 && cpeAgg._count === 0 ? (
            // No membership and nothing recorded yet: one next step instead of two zero tiles (QA-PORTALS-24).
            <div className="mbr-empty-sm"><EmptyState level={3} title={td("noEventsD")} action={<a className="btn btn-secondary btn-sm" href={L("/events")}>{tev("browse")}</a>}>{tev("noUpcoming")}</EmptyState></div>
          ) : (
            <div className="kpis mbr-kpis">
              <a className={`kpi${unpaid.length ? " kpi-attn" : ""}`} href={L("/my/events")}><span className="k">{td("upcoming")}</span><span className="v">{regs.length}</span>
                <span className="d">{unpaid.length ? td("awaitingPayN", { n: unpaid.length }) : next ? td("nextEvent", { title: next.title, date: next.planned ? te("dateTbc") : fmtDate(regs[0]!.event.startsAt, locale, false) }) : td("noEventsD")}</span>
                <span className="kpi-go" aria-hidden="true"><Icon name="arrow-right" size={18} /></span></a>
              <div className="kpi is-blue"><span className="k">{td("cpe")}</span><span className="v">{td("hours", { n: cpe })}</span><span className="d">{td("cpeEntries", { n: cpeAgg._count })}</span></div>
            </div>
          )}
        </section>

        {paidTickets.length > 0 && (
          <section className="mbr-section" aria-labelledby="h-tix">
            <SectionHead id="h-tix" title={t("ticketsTitle")} count={paidTickets.length} />
            <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="h-tix"><table>
              <thead><tr><th>{t("colEvent")}</th><th>{t("colDate")}</th><th className="num">{t("colAmount")}</th><th>{t("colStatus")}</th></tr></thead>
              <tbody>{paidTickets.map((r) => <tr key={r.id}>
                <td><a href={L(`/events/${r.event.slug}`)}>{locale === "fr" && r.event.titleFr ? r.event.titleFr : r.event.title}</a></td>
                <td>{fmtDate(r.event.startsAt, locale)}</td>
                <td className="num">{fmt(r.amountCents, r.currency as Currency, locale)}</td>
                <td><Status tone="success">{t("paid")}</Status></td>
              </tr>)}</tbody>
            </table></div>
          </section>
        )}
      </main>
    </div>
  );
}
