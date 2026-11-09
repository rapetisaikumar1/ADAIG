import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { getTier, type Locale } from "@/config/site";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
export const dynamic = "force-dynamic";

export default async function AdminDash({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin");
  const notDeleted = { user: { role: { not: "deleted" } } };
  // Member KPIs and the "recently activated" list count members only: staff admins (who may hold a membership) are excluded.
  const membersOnly = { user: { role: { notIn: ["deleted", "admin"] } } };
  const [activeRows, guests, regs, recent, logs, pending] = await Promise.all([
    db.membership.findMany({ where: { status: "active", ...membersOnly }, select: { userId: true, tierId: true } }),
    db.user.count({ where: { role: "guest" } }), db.registration.count({ where: { status: "confirmed" } }),
    db.membership.findMany({ where: { status: "active", ...membersOnly }, include: { user: true }, orderBy: { startsAt: "desc" }, take: 6 }),
    // seed.* entries are setup noise, not staff-relevant activity
    db.auditLog.findMany({ where: { NOT: { action: { startsWith: "seed." } } }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.membership.findMany({ where: { status: "pending_verification", ...notDeleted }, include: { user: true }, orderBy: { createdAt: "asc" } }),
  ]);
  // BUG-040: count distinct PEOPLE (a user with two active rows counts once), overall and per tier.
  const active = new Set(activeRows.map((r) => r.userId)).size;
  const tierPeople = new Map<string, Set<string>>();
  for (const r of activeRows) { if (!tierPeople.has(r.tierId)) tierPeople.set(r.tierId, new Set()); tierPeople.get(r.tierId)!.add(r.userId); }
  const byTier = [...tierPeople].map(([tierId, set]) => ({ tierId, n: set.size }));
  const dl = dateLocale(locale);
  const day = (d: Date | null | undefined) => d ? d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone }) : "—";
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${t("et")}`;
  // "auth.login_failed" → admin.log.auth_login_failed; unknown codes fall back to a readable form of the code.
  const logLabel = (a: string) => { const k = `log.${a.replace(/\./g, "_")}`; return t.has(k) ? t(k) : a.replace(/^[a-z]+\./, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase()); };
  const L = (p: string) => `/${locale}${p}`;
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/dashboard" />
      <main id="main" className="app-main">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1></div></div>
        <div className="grid g4 adm-kpis">
          <div className={`kpi${pending.length ? " kpi-attn" : ""}`}><div className="k">{t("pendingKpi")}</div><div className="v">{pending.length}</div><div className="d">{pending.length ? <a href={L("/admin/members?f=pending")}>{t("reviewNow")} →</a> : t("noneWaiting")}</div></div>
          <div className="kpi"><div className="k">{t("members")}</div><div className="v">{active}</div><div className="d">{byTier.length ? byTier.map((b) => `${getTier(b.tierId)?.name[locale]}: ${b.n}`).join(" · ") : t("noMembersYet")}</div></div>
          <div className="kpi"><div className="k">{t("guests")}</div><div className="v">{guests}</div><div className="d">{t("guestsHint")}</div></div>
          <div className="kpi"><div className="k">{t("regs")}</div><div className="v">{regs}</div><div className="d">{t("allEvents")}</div></div>
        </div>
        {/* The review queue only appears when there is something to review (the KPI above already says "Nothing waiting"). */}
        {pending.length > 0 && <section className="card adm-section">
          <div className="adm-card-head"><h2 style={h2}>{t("pendingTitle")}</h2><a className="small" href={L("/admin/members?f=pending")}>{t("openQueue")} →</a></div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("pendingTitle")}><table className="adm-stack adm-stack-2"><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("applied")}</th></tr></thead><tbody>
            {pending.slice(0, 6).map((m) => <tr key={m.id}><td data-label={t("name")}>{m.user.name}<div className="small muted">{m.user.organisation}</div></td><td data-label={t("tier")}>{getTier(m.tierId)?.name[locale] ?? m.tierId}</td><td className="nowrap" data-label={t("applied")}>{day(m.createdAt)}</td></tr>)}
          </tbody></table></div>
        </section>}
        <div className="grid g2 adm-dash-grid">
          <section className="card">
            <div className="adm-card-head"><h2 style={h2}>{t("recent")}</h2><a className="small" href={L("/admin/members?f=active")}>{t("allMembers")} →</a></div>
            {recent.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label={t("recent")}><table className="adm-stack adm-stack-2"><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("since")}</th></tr></thead><tbody>
              {recent.map((m) => <tr key={m.id}><td data-label={t("name")}>{m.user.name}</td><td data-label={t("tier")}>{getTier(m.tierId)?.name[locale]}</td><td className="nowrap" data-label={t("since")}>{day(m.startsAt)}</td></tr>)}
            </tbody></table></div> : <div className="adm-empty"><p>{t("noMembersYet")}</p></div>}
          </section>
          <section className="card"><h2 style={h2}>{t("audit")}</h2>
            {logs.length ? <ul className="adm-log">{logs.map((l) => <li key={l.id}><span>{logLabel(l.action)}</span><time className="small muted" dateTime={l.createdAt.toISOString()}>{stamp(l.createdAt)}</time></li>)}</ul>
              : <div className="adm-empty"><p>{t("noActivity")}</p></div>}
          </section>
        </div>
      </main>
    </div>
  );
}
