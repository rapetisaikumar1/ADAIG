import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser, activeMembership } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { fmt, type Currency, type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { fmtDate } from "../_shared/util";
export const dynamic = "force-dynamic";

/** Membership status. Membership fees are not taken online: the ADAIG team invoices members directly. */
export default async function MyMembership({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const t = await getTranslations("member.billingPage");
  const m = (await activeMembership(u.id))
    ?? (await db.membership.findFirst({ where: { userId: u.id, status: "pending_verification" }, orderBy: { createdAt: "desc" } }))
    ?? (await db.membership.findFirst({ where: { userId: u.id, status: "rejected_verification" }, orderBy: { createdAt: "desc" } }));
  const paidTickets = await db.registration.findMany({ where: { userId: u.id, status: "confirmed", amountCents: { gt: 0 } }, include: { event: true }, orderBy: { event: { startsAt: "desc" } } });
  const getTier = await tierLookup();
  const L = (p: string) => `/${locale}${p}`;
  const status = m?.status ?? "none";
  const badge = status === "active" ? "badge-green" : status === "pending_verification" ? "badge-amber" : status === "rejected_verification" ? "badge-red" : "";
  const rows: [string, string][] = m ? [
    [t("tier"), getTier(m.tierId)?.name[locale] ?? m.tierId],
    ...(m.status === "active" && m.startsAt ? [[t("since"), fmtDate(m.startsAt, locale)] as [string, string]] : []),
    ...(m.status === "active" && m.renewsAt ? [[t("renews"), fmtDate(m.renewsAt, locale)] as [string, string]] : []),
    ...(m.status !== "active" ? [[t("applied"), fmtDate(m.createdAt, locale)] as [string, string]] : []),
  ] : [];
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/billing" />
      <main id="main" className="app-main mbr">
        <div className="app-head"><h1>{t("title")}</h1></div>
        <div className="grid g2 mbr-cards">
          <section className="card" aria-labelledby="h-status">
            <div className="mbr-row"><h2 id="h-status" style={h2}>{t("statusTitle")}</h2><span className={`badge ${badge}`}>{t(`st_${status}`)}</span></div>
            {rows.length > 0 && <dl className="mbr-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
            {status === "none" && <p>{t("noneBody")}</p>}
            {status === "pending_verification" && <p>{t("reviewBody")}</p>}
            {status === "rejected_verification" && <p>{t("rejectedBody")}</p>}
            {status !== "pending_verification" && <div className="mbr-foot"><a className="btn btn-secondary btn-sm" href={L("/membership")}>{t("compare")}</a></div>}
          </section>
          <section className="card" aria-labelledby="h-inv">
            <h2 id="h-inv" style={h2}>{t("invoicingTitle")}</h2>
            <p>{t("invoicingBody")}</p>
            <p className="small">{t("invoicingHelp")}</p>
            <div className="mbr-foot"><a className="btn btn-secondary btn-sm" href={L("/contact")}>{t("contact")}</a></div>
          </section>
        </div>
        {paidTickets.length > 0 && <>
          <h2 className="mbr-section-title">{t("ticketsTitle")}</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("ticketsTitle")}><table>
            <thead><tr><th>{t("colEvent")}</th><th>{t("colDate")}</th><th className="num">{t("colAmount")}</th><th>{t("colStatus")}</th></tr></thead>
            <tbody>{paidTickets.map((r) => <tr key={r.id}>
              <td><a href={L(`/events/${r.event.slug}`)}>{locale === "fr" && r.event.titleFr ? r.event.titleFr : r.event.title}</a></td>
              <td>{fmtDate(r.event.startsAt, locale)}</td>
              <td className="num">{fmt(r.amountCents, r.currency as Currency, locale)}</td>
              <td><span className="badge badge-green">{t("paid")}</span></td>
            </tr>)}</tbody>
          </table></div>
        </>}
      </main>
    </div>
  );
}
