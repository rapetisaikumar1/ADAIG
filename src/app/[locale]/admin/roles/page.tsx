import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { can, canManageRole, requireAdminPermission } from "@/lib/rbac";
import { MODULES, effectivePermissions, moduleLevel } from "@/lib/permissions";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { AdminHead, AdminEmpty, AdminReadOnly } from "../_components/AdminUI";
import { type Locale } from "@/config/site";
export const dynamic = "force-dynamic";

const NOTICES: Record<string, "alert-success" | "alert-danger"> = { msg_deleted: "alert-success", notFound: "alert-danger" };
const LEVEL_TONE = { full: "status-available", view: "status-neutral", custom: "status-dev" } as const;

/**
 * Admin → Roles (round 7, SPEC_R7 §5.1): every Admin Portal role with its description, a per-module permission summary
 * (Full / View / Custom / None), how many users have it, and Manage/View. Super Admin (system role) first, then by name.
 */
export default async function AdminRoles({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "roles", "view");
  const t = await getTranslations("adminRoles"); const ta = await getTranslations("admin");
  const { msg } = await searchParams;
  const roles = await db.adminRole.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { _count: { select: { users: true } } } });
  const L = (p: string) => `/${locale}${p}`;
  const canCreate = can(ctx, "roles", "create"), canEdit = can(ctx, "roles", "edit"), canUsers = can(ctx, "users", "view");
  const notice = msg && NOTICES[msg] ? { cls: NOTICES[msg], text: t(msg as "msg_deleted") } : null;
  const createBtn = <a className="btn btn-primary btn-sm" href={L("/admin/roles/new")}><Icon name="plus" size={16} />{t("newRole")}</a>;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/roles" />
      <main id="main" tabIndex={-1} className="app-main rl-page">
        <AdminHead title={t("title")} lead={t("lead")} actions={canCreate ? createBtn : undefined} />
        {notice && <FocusOnLoad><div className={`alert ${notice.cls} adm-notice`} role={notice.cls === "alert-danger" ? "alert" : "status"}><div>{notice.text}</div></div></FocusOnLoad>}
        {!canCreate && !canEdit && <AdminReadOnly text={ta("readOnly")} />}
        {roles.length === 0 ? <AdminEmpty title={t("emptyTitle")} action={canCreate ? createBtn : undefined}>{t("emptyBody")}</AdminEmpty> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={ta("scrollRegion", { name: t("title") })}>
            <table className="adm-table rl-table"><caption className="sr-only">{t("title")}</caption>
              <thead><tr>
                <th scope="col" className="rl-col-role">{t("colRole")}</th>
                {MODULES.map((m) => <th scope="col" key={m} className="rl-col-lvl">{t(`mod_${m}`)}</th>)}
                <th scope="col" className="rl-col-users">{t("colAssigned")}</th>
                <th scope="col" className="adm-col-actions"><span className="sr-only">{ta("action")}</span></th>
              </tr></thead>
              <tbody>
                {roles.map((r) => {
                  const perms = effectivePermissions(r);
                  const manage = canEdit && canManageRole(ctx, r);
                  const n = r._count.users;
                  return (
                    <tr key={r.id} className={r.isSystem ? "is-system" : undefined}>
                      <td className="rl-cell-role" data-label={t("colRole")}>
                        <div className="rl-role">
                          <span className="rl-role-line">
                            <a className="rl-role-name" href={L(`/admin/roles/${encodeURIComponent(r.id)}`)}>{r.name}</a>
                            {r.isSystem && <span className="badge rl-system"><Icon name="shield" size={14} />{t("system")}</span>}
                            {ctx.role?.id === r.id && <span className="adm-you">{t("yourRole")}</span>}
                          </span>
                          {r.description && <span className="small muted rl-desc">{r.description}</span>}
                        </div>
                      </td>
                      {MODULES.map((m) => {
                        const lvl = moduleLevel(perms, m);
                        return (
                          <td key={m} className="rl-lvl" data-label={t(`mod_${m}`)}>
                            {lvl === "none" ? <span className="rl-none">{t("lvl_none")}</span> : (
                              <span className="rl-lvl-box">
                                <span className={`status ${LEVEL_TONE[lvl]}`}>{t(`lvl_${lvl}`)}</span>
                                {lvl === "custom" && <span className="rl-acts small">{(perms[m] ?? []).map((a) => t(`act_${a}`)).join(", ")}</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="rl-users" data-label={t("colAssigned")}>
                        {canUsers && n > 0 ? <a href={L(`/admin/users?role=${encodeURIComponent(r.id)}`)}>{t("usersN", { n })}</a> : <span className={n ? undefined : "muted"}>{t("usersN", { n })}</span>}
                      </td>
                      <td className="adm-col-actions">
                        <a className="btn btn-secondary btn-sm" href={L(`/admin/roles/${encodeURIComponent(r.id)}`)} aria-label={`${manage ? t("manage") : t("viewRole")}: ${r.name}`}>{manage ? t("manage") : t("viewRole")}</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
