import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
import { AUDIT_PAGE_SIZE, auditLabel, auditWhere, parseAuditFilters, resolveRefs, type AuditFilters, type Ref } from "@/lib/audit";
export const dynamic = "force-dynamic";

/** Audit log viewer: filters (action, actor, target, ET date range), pagination, readable labels, CSV export with the same filters. */
export default async function AdminAudit({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("audit"); const ta = await getTranslations("admin");
  const f = parseAuditFilters(await searchParams);
  const where = await auditWhere(f);
  const [total, actions] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(f.p, pages);
  const rows = await db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE });
  const refs = await resolveRefs(rows.flatMap((r) => [r.actor, r.target ?? ""]), locale);

  // Action picker: one group per prefix ("membership."), each with its actions.
  const groups = new Map<string, { action: string; n: number }[]>();
  for (const a of actions) { const g = a.action.includes(".") ? a.action.slice(0, a.action.indexOf(".") + 1) : a.action; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push({ action: a.action, n: a._count._all }); }
  const known = f.a && !actions.some((a) => a.action === f.a) && !groups.has(f.a) ? f.a : null; // a typed prefix not in the list stays selectable

  const dl = dateLocale(locale);
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${t("et")}`;
  const qs = (over: Partial<AuditFilters>) => {
    const v = { ...f, ...over }; const p = new URLSearchParams();
    for (const k of ["a", "actor", "target", "from", "to"] as const) if (v[k]) p.set(k, v[k]);
    if (v.p > 1) p.set("p", String(v.p));
    const s = p.toString(); return s ? `?${s}` : "";
  };
  const filtered = !!(f.a || f.actor || f.target || f.from || f.to);
  const SPECIAL = ["system", "seed", "cli", "public"];
  const who = (v: string, ref?: Ref) => {
    if (ref) return (
      <div className="adm-person">
        {ref.href ? <a href={ref.href}>{ref.label}</a> : <span>{ref.label}</span>}
        <span className="small muted">{t(`kind_${ref.kind}`)}{ref.detail ? ` · ${ref.detail}` : ""}</span>
      </div>);
    if (SPECIAL.includes(v)) return <span>{t(`actor_${v}`)}</span>;
    return <code className="adm-code">{v}</code>;
  };
  const ref = (v: string | null) => (v ? refs.get(v.split(" ")[0]) : undefined);
  const first = total ? (page - 1) * AUDIT_PAGE_SIZE + 1 : 0, last = Math.min(page * AUDIT_PAGE_SIZE, total);

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/audit" />
      <main id="main" className="app-main adm-audit">
        <div className="app-head">
          <div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="muted adm-lead">{t("lead")}</p></div>
          <a className="btn btn-secondary btn-sm" href={`/api/admin/audit.csv${qs({ p: 1 })}`}>{t("exportCsv")}</a>
        </div>
        <form className="card adm-filterbar" method="get" action={`/${locale}/admin/audit`} role="search" aria-label={t("filters")}>
          <div className="field"><label htmlFor="au-a">{t("action")}</label>
            <select id="au-a" name="a" defaultValue={f.a}>
              <option value="">{t("allActions")}</option>
              {known && <option value={known}>{known}</option>}
              {[...groups].map(([g, list]) => (
                <optgroup key={g} label={g.replace(/\.$/, "")}>
                  {g.endsWith(".") && (list.length > 1 || f.a === g) && <option value={g}>{t("allInGroup", { group: g.replace(/\.$/, "") })}</option>}
                  {list.map((x) => <option key={x.action} value={x.action}>{auditLabel(ta, x.action)} ({x.n})</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field"><label htmlFor="au-actor">{t("actor")}</label><input id="au-actor" name="actor" type="search" defaultValue={f.actor} maxLength={200} placeholder={t("actorPh")} /></div>
          <div className="field"><label htmlFor="au-target">{t("target")}</label><input id="au-target" name="target" type="search" defaultValue={f.target} maxLength={200} placeholder={t("targetPh")} /></div>
          <div className="field"><label htmlFor="au-from">{t("from")} <span className="hint">({t("et")})</span></label><input id="au-from" name="from" type="date" defaultValue={f.from} /></div>
          <div className="field"><label htmlFor="au-to">{t("to")} <span className="hint">({t("et")})</span></label><input id="au-to" name="to" type="date" defaultValue={f.to} /></div>
          <div className="adm-filterbar-actions"><button className="btn btn-primary btn-sm">{t("apply")}</button>{filtered && <a className="btn btn-secondary btn-sm" href={`/${locale}/admin/audit`}>{t("reset")}</a>}</div>
        </form>
        <p className="small muted adm-count" role="status">{total ? t("showing", { first, last, total }) : null}</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")}>
          <table className="adm-table adm-stack adm-stack-2 adm-table-audit"><caption className="sr-only">{t("title")}</caption>
            <thead><tr><th scope="col">{t("when")}</th><th scope="col">{t("action")}</th><th scope="col">{t("actor")}</th><th scope="col">{t("target")}</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 32 }}>{filtered ? t("noResults") : t("empty")}</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap" data-label={t("when")}><time dateTime={r.createdAt.toISOString()}>{stamp(r.createdAt)}</time></td>
                  <td data-label={t("action")}><div className="adm-person"><span>{auditLabel(ta, r.action)}</span><code className="adm-code small muted">{r.action}</code></div></td>
                  <td data-label={t("actor")}>{who(r.actor, ref(r.actor))}</td>
                  <td data-label={t("target")}>{r.target ? <>{who(r.target, ref(r.target))}{ref(r.target) && r.target.includes(" ") ? <span className="small muted"> {r.target.slice(r.target.indexOf(" ") + 1)}</span> : null}</> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav aria-label={t("pagination")} className="adm-pager">
            {page > 1 ? <a className="btn btn-secondary btn-sm" href={`/${locale}/admin/audit${qs({ p: page - 1 })}`} rel="prev">← {t("newer")}</a> : <span />}
            <span className="small muted">{t("pageOf", { page, pages })}</span>
            {page < pages ? <a className="btn btn-secondary btn-sm" href={`/${locale}/admin/audit${qs({ p: page + 1 })}`} rel="next">{t("older")} →</a> : <span />}
          </nav>
        )}
      </main>
    </div>
  );
}
