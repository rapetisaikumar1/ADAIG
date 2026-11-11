import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { AdminTools } from "@/components/AdminTools";
import { AdminHead } from "../_components/AdminUI";
import { Icon } from "@/components/ui/Icon";
import { type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { auditLabel } from "@/lib/audit";
export const dynamic = "force-dynamic";

export default async function AdminDash({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "system", "view"); const t = await getTranslations("admin"); const ta = await getTranslations("adminTools");
  // Links go only to modules the role can view (§5.5); the numbers themselves are part of the Overview (system.view).
  const canMembers = can(ctx, "members", "view"), canMessages = can(ctx, "messages", "view");
  // Same rule as Admin → Members: association accounts only (Admin Portal users are managed in Users, round 7 D1).
  const notDeleted = { user: { role: { notIn: ["deleted", "admin"] } } };
  const person = { id: true, name: true, organisation: true, role: true } as const;
  const [activeRows, guests, regs, recent, logs, pending, pendingN, unread] = await Promise.all([
    db.membership.findMany({ where: { status: "active", ...notDeleted }, select: { userId: true, tierId: true } }),
    db.user.count({ where: { role: "guest" } }), db.registration.count({ where: { status: "confirmed" } }),
    db.membership.findMany({ where: { status: "active", ...notDeleted }, select: { id: true, tierId: true, startsAt: true, user: { select: person } }, orderBy: { startsAt: { sort: "desc", nulls: "last" } }, take: 6 }), // nulls last, as on SQLite
    // seed.* entries are setup noise, not staff-relevant activity
    db.auditLog.findMany({ where: { NOT: { action: { startsWith: "seed.", mode: "insensitive" } } }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.membership.findMany({ where: { status: "pending_verification", ...notDeleted }, select: { id: true, tierId: true, createdAt: true, user: { select: person } }, orderBy: { createdAt: "asc" }, take: 6 }),
    db.membership.count({ where: { status: "pending_verification", ...notDeleted } }),
    db.contactMessage.count({ where: { status: "new" } }),
  ]);
  // BUG-040: count distinct PEOPLE (a user with two active rows counts once), overall and per tier.
  const active = new Set(activeRows.map((r) => r.userId)).size;
  const tierPeople = new Map<string, Set<string>>();
  for (const r of activeRows) { if (!tierPeople.has(r.tierId)) tierPeople.set(r.tierId, new Set()); tierPeople.get(r.tierId)!.add(r.userId); }
  const byTier = [...tierPeople].map(([tierId, set]) => ({ tierId, n: set.size }));
  const getTier = await tierLookup();
  const dl = dateLocale(locale);
  const day = (d: Date | null | undefined) => d ? d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone }) : "—";
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${t("et")}`;
  const L = (p: string) => `/${locale}${p}`;
  const logLabel = (a: string) => auditLabel(t, a); // "auth.login_failed" → admin.log.auth_login_failed
  const colon = locale === "fr" ? "\u00a0: " : ": ";
  const member = (u: { id: string; name: string }) => canMembers ? <a href={L(`/admin/members/${u.id}`)}>{u.name}</a> : <span>{u.name}</span>;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/dashboard" />
      <main id="main" tabIndex={-1} className="app-main adm-dash">
        <AdminHead title={t("title")} lead={t("overviewLead")} />
        {/* Real counts only (DESIGN §10.1). Tiles that need action link to the place where it is done. */}
        <div className="kpis adm-kpis-5">
          {pendingN && canMembers ? <a className="kpi kpi-attn" href={L("/admin/members?f=pending")}><span className="k">{t("pendingKpi")}</span><span className="v">{pendingN}</span><span className="d">{t("reviewNow")}<Icon name="arrow-right" size={14} /></span></a>
            : <div className={`kpi${pendingN ? " kpi-attn" : ""}`}><div className="k">{t("pendingKpi")}</div><div className="v">{pendingN}</div><div className="d">{pendingN ? t("needsAction") : t("noneWaiting")}</div></div>}
          {unread && canMessages ? <a className="kpi kpi-attn" href={L("/admin/messages")}><span className="k">{t("newMessagesKpi")}</span><span className="v">{unread}</span><span className="d">{t("openInbox")}<Icon name="arrow-right" size={14} /></span></a>
            : <div className={`kpi${unread ? " kpi-attn" : ""}`}><div className="k">{t("newMessagesKpi")}</div><div className="v">{unread}</div><div className="d">{unread ? t("needsAction") : t("noneWaiting")}</div></div>}
          <div className="kpi is-blue"><div className="k">{t("members")}</div><div className="v">{active}</div><div className="d">{byTier.length ? byTier.map((b) => `${getTier(b.tierId)?.name[locale] ?? b.tierId}${colon}${b.n}`).join(" · ") : t("noMembersYet")}</div></div>
          <div className="kpi is-navy"><div className="k">{t("guests")}</div><div className="v">{guests}</div><div className="d">{t("guestsHint")}</div></div>
          <div className="kpi is-navy"><div className="k">{t("regs")}</div><div className="v">{regs}</div><div className="d">{t("allEvents")}</div></div>
        </div>
        {/* The review queue only appears when there is something to review (the KPI above already says "Nothing waiting"). */}
        {pendingN > 0 && <section className="panel adm-section" aria-labelledby="dash-pending">
          <div className="panel-head"><h2 id="dash-pending">{t("pendingTitle")}</h2>{canMembers && <a className="small link-arrow" href={L("/admin/members?f=pending")}>{t("openQueue")}</a>}</div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("scrollRegion", { name: t("pendingTitle") })}><table className="adm-table adm-stack adm-stack-2 adm-table-compact"><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("applied")}</th></tr></thead><tbody>
            {pending.map((m) => <tr key={m.id}><td data-label={t("name")} className="adm-cell-person"><div className="adm-person">{member(m.user)}{m.user.organisation && <span className="small">{m.user.organisation}</span>}</div></td><td data-label={t("tier")}>{getTier(m.tierId)?.name[locale] ?? m.tierId}</td><td className="nowrap" data-label={t("applied")}>{day(m.createdAt)}</td></tr>)}
          </tbody></table></div>
        </section>}
        <div className="adm-grid-2">
          <section className="panel" aria-labelledby="dash-recent">
            <div className="panel-head"><h2 id="dash-recent">{t("recent")}</h2>{canMembers && <a className="small link-arrow" href={L("/admin/members?f=active")}>{t("allMembers")}</a>}</div>
            {recent.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label={t("scrollRegion", { name: t("recent") })}><table className="adm-table adm-stack adm-stack-2 adm-table-compact"><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("since")}</th></tr></thead><tbody>
              {recent.map((m) => <tr key={m.id}><td data-label={t("name")} className="adm-cell-person"><div className="adm-person">{member(m.user)}</div></td><td data-label={t("tier")}>{getTier(m.tierId)?.name[locale] ?? m.tierId}</td><td className="nowrap" data-label={t("since")}>{day(m.startsAt)}</td></tr>)}
            </tbody></table></div> : <p className="adm-empty-inline">{t("noMembersYet")}</p>}
          </section>
          <section className="panel" aria-labelledby="dash-audit"><div className="panel-head"><h2 id="dash-audit">{t("audit")}</h2><a className="small link-arrow" href={L("/admin/audit")}>{ta("viewAll")}</a></div>
            {logs.length ? <ul className="adm-log">{logs.map((l) => <li key={l.id}><span>{logLabel(l.action)}</span><time className="small muted" dateTime={l.createdAt.toISOString()}>{stamp(l.createdAt)}</time></li>)}</ul>
              : <p className="adm-empty-inline">{t("noActivity")}</p>}
          </section>
        </div>
        <AdminTools locale={locale} />
      </main>
    </div>
  );
}
