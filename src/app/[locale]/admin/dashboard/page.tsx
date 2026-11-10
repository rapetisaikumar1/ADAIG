import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { AdminTools } from "@/components/AdminTools";
import { type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { auditLabel } from "@/lib/audit";
export const dynamic = "force-dynamic";

export default async function AdminDash({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin"); const ta = await getTranslations("adminTools");
  // Same rule as Admin → Members ("Active" tab): everyone with an active membership, staff included (shown as "incl. n staff").
  const notDeleted = { user: { role: { not: "deleted" } } };
  const person = { id: true, name: true, organisation: true, role: true } as const;
  const [activeRows, guests, regs, recent, logs, pending, pendingN, unread] = await Promise.all([
    db.membership.findMany({ where: { status: "active", ...notDeleted }, select: { userId: true, tierId: true, user: { select: { role: true } } } }),
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
  const staffActive = new Set(activeRows.filter((r) => r.user.role === "admin").map((r) => r.userId)).size;
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
  const member = (u: { id: string; name: string }) => <a href={L(`/admin/members/${u.id}`)}>{u.name}</a>;
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/dashboard" />
      <main id="main" className="app-main">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1></div></div>
        <div className="grid g4 adm-kpis adm-kpis-5">
          <div className={`kpi${pendingN ? " kpi-attn" : ""}`}><div className="k">{t("pendingKpi")}</div><div className="v">{pendingN}</div><div className="d">{pendingN ? <a href={L("/admin/members?f=pending")}>{t("reviewNow")} →</a> : t("noneWaiting")}</div></div>
          <div className={`kpi${unread ? " kpi-attn" : ""}`}><div className="k">{t("newMessagesKpi")}</div><div className="v">{unread}</div><div className="d">{unread ? <a href={L("/admin/messages")}>{t("openInbox")} →</a> : t("noneWaiting")}</div></div>
          <div className="kpi"><div className="k">{t("members")}</div><div className="v">{active}</div><div className="d">{byTier.length ? byTier.map((b) => `${getTier(b.tierId)?.name[locale] ?? b.tierId}${colon}${b.n}`).join(" · ") : t("noMembersYet")}{staffActive ? ` · ${t("inclStaff", { n: staffActive })}` : ""}</div></div>
          <div className="kpi"><div className="k">{t("guests")}</div><div className="v">{guests}</div><div className="d">{t("guestsHint")}</div></div>
          <div className="kpi"><div className="k">{t("regs")}</div><div className="v">{regs}</div><div className="d">{t("allEvents")}</div></div>
        </div>
        {/* The review queue only appears when there is something to review (the KPI above already says "Nothing waiting"). */}
        {pendingN > 0 && <section className="card adm-section">
          <div className="adm-card-head"><h2 style={h2}>{t("pendingTitle")}</h2><a className="small" href={L("/admin/members?f=pending")}>{t("openQueue")} →</a></div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("pendingTitle")}><table className="adm-stack adm-stack-2"><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("applied")}</th></tr></thead><tbody>
            {pending.map((m) => <tr key={m.id}><td data-label={t("name")}>{member(m.user)}<div className="small muted">{m.user.organisation}</div></td><td data-label={t("tier")}>{getTier(m.tierId)?.name[locale] ?? m.tierId}</td><td className="nowrap" data-label={t("applied")}>{day(m.createdAt)}</td></tr>)}
          </tbody></table></div>
        </section>}
        <div className="grid g2 adm-dash-grid">
          <section className="card">
            <div className="adm-card-head"><h2 style={h2}>{t("recent")}</h2><a className="small" href={L("/admin/members?f=active")}>{t("allMembers")} →</a></div>
            {recent.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label={t("recent")}><table className="adm-stack adm-stack-2"><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("since")}</th></tr></thead><tbody>
              {recent.map((m) => <tr key={m.id}><td data-label={t("name")}>{member(m.user)}</td><td data-label={t("tier")}>{getTier(m.tierId)?.name[locale] ?? m.tierId}</td><td className="nowrap" data-label={t("since")}>{day(m.startsAt)}</td></tr>)}
            </tbody></table></div> : <div className="adm-empty"><p>{t("noMembersYet")}</p></div>}
          </section>
          <section className="card"><div className="adm-card-head"><h2 style={h2}>{t("audit")}</h2><a className="small" href={L("/admin/audit")}>{ta("viewAll")} →</a></div>
            {logs.length ? <ul className="adm-log">{logs.map((l) => <li key={l.id}><span>{logLabel(l.action)}</span><time className="small muted" dateTime={l.createdAt.toISOString()}>{stamp(l.createdAt)}</time></li>)}</ul>
              : <div className="adm-empty"><p>{t("noActivity")}</p></div>}
          </section>
        </div>
        <AdminTools locale={locale} />
      </main>
    </div>
  );
}
