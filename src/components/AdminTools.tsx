import { getTranslations } from "next-intl/server";

/** Admin dashboard: quick links to every staff tool and the CSV exports (all exports check the admin role server-side). */
export async function AdminTools({ locale }: { locale: string }) {
  const t = await getTranslations("adminTools");
  const L = (p: string) => `/${locale}${p}`;
  const tools: [string, "members" | "events" | "messages" | "content" | "settings" | "audit" | "system"][] = [
    ["/admin/members", "members"], ["/admin/events", "events"], ["/admin/messages", "messages"], ["/admin/content", "content"],
    ["/admin/settings", "settings"], ["/admin/audit", "audit"], ["/admin/system", "system"],
  ];
  const exports: [string, "csvMembers" | "csvRegistrations" | "csvMessages" | "csvAudit"][] = [
    ["/api/admin/members.csv", "csvMembers"], ["/api/admin/registrations.csv", "csvRegistrations"], ["/api/admin/messages.csv", "csvMessages"], ["/api/admin/audit.csv", "csvAudit"],
  ];
  return (
    <section className="card adm-section adm-tools" aria-labelledby="adm-tools-h">
      <h2 id="adm-tools-h" style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{t("title")}</h2>
      <ul className="adm-tools-grid" aria-label={t("manage")}>
        {tools.map(([href, k]) => <li key={k}><a href={L(href)}><b>{t(k)}</b><span className="small muted">{t(`${k}Hint`)}</span></a></li>)}
      </ul>
      <div className="adm-tools-exports"><span className="small"><b>{t("exports")}</b></span>
        {exports.map(([href, k]) => <a key={k} className="btn btn-secondary btn-sm" href={href} download>{t(k)}</a>)}
      </div>
      {/* Planned staff tools: static previews with sample data (not in the admin menu, since they don't work yet). */}
      <div className="adm-tools-exports adm-tools-planned"><span className="small"><b>{t("planned")}</b> <span className="badge badge-amber">{t("plannedBadge")}</span></span>
        <a className="btn btn-secondary btn-sm" href={L("/admin/corporate")}>{t("plannedCorporate")}</a>
        <a className="btn btn-secondary btn-sm" href={L("/admin/chapter")}>{t("plannedChapter")}</a>
        <span className="small muted">{t("plannedHint")}</span>
      </div>
    </section>
  );
}
