import { getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getAdminContext } from "@/lib/rbac";
import { canPerm, type Module } from "@/lib/permissions";

type ToolKey = "members" | "events" | "messages" | "users" | "roles" | "settings" | "audit" | "system";
type CsvKey = "csvMembers" | "csvRegistrations" | "csvMessages" | "csvAudit";

/**
 * Admin dashboard: quick links to the staff tools and the CSV exports. Round 7 (SPEC_R7 §5.5): each tool and export is listed only
 * when the signed-in admin's role can view its module (the pages and exports check the same permission server-side). Settings,
 * Audit log, System and the planned-tool previews belong to the "system" module, which this dashboard itself requires.
 */
export async function AdminTools({ locale }: { locale: string }) {
  const t = await getTranslations("adminTools");
  const perms = (await getAdminContext())?.permissions;
  const sees = (m: Module) => canPerm(perms, m, "view");
  const L = (p: string) => `/${locale}${p}`;
  const tools = ([
    ["/admin/members", "members", "users", "members"], ["/admin/events", "events", "calendar", "events"], ["/admin/messages", "messages", "inbox", "messages"],
    ["/admin/users", "users", "id-badge", "users"], ["/admin/roles", "roles", "key", "roles"],
    ["/admin/settings", "settings", "settings", "system"], ["/admin/audit", "audit", "shield", "system"], ["/admin/system", "system", "layers", "system"],
  ] as [string, ToolKey, IconName, Module][]).filter(([, , , m]) => sees(m));
  const exports = ([
    ["/api/admin/members.csv", "csvMembers", "members"], ["/api/admin/registrations.csv", "csvRegistrations", "events"],
    ["/api/admin/messages.csv", "csvMessages", "messages"], ["/api/admin/audit.csv", "csvAudit", "system"],
  ] as [string, CsvKey, Module][]).filter(([, , m]) => sees(m));
  return (
    <section className="panel adm-section adm-tools" aria-labelledby="adm-tools-h">
      <div className="panel-head"><h2 id="adm-tools-h">{t("title")}</h2></div>
      {tools.length > 0 && <ul className="adm-tools-grid" aria-label={t("manage")}>
        {tools.map(([href, k, icon]) => <li key={k}><a href={L(href)}><span className="adm-tool-ic"><Icon name={icon} size={20} /></span><b>{t(k)}</b><span className="small">{t(`${k}Hint`)}</span></a></li>)}
      </ul>}
      {exports.length > 0 && <div className="adm-tools-row"><span className="adm-tools-label"><Icon name="download" size={18} />{t("exports")}</span>
        {exports.map(([href, k]) => <a key={k} className="btn btn-secondary btn-sm" href={href} download>{t(k)}</a>)}
      </div>}
      {/* Planned staff tools: static previews with sample data (not in the admin menu, since they don't work yet). */}
      {sees("system") && <div className="adm-tools-row adm-tools-planned"><span className="adm-tools-label">{t("planned")} <span className="status status-dev">{t("plannedBadge")}</span></span>
        <a className="btn btn-ghost btn-sm" href={L("/admin/corporate")}>{t("plannedCorporate")}</a>
        <a className="btn btn-ghost btn-sm" href={L("/admin/chapter")}>{t("plannedChapter")}</a>
        <span className="small muted">{t("plannedHint")}</span>
      </div>}
    </section>
  );
}
