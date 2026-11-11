import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { can, canManageUser, requireAdminPermission } from "@/lib/rbac";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Facet";
import { AdminHead, AdminTabs, AdminSearch, AdminEmpty, Email, type TabItem } from "../_components/AdminUI";
import { type Locale } from "@/config/site";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { USER_FILTERS, USERS_BASE, userFilter, userQuery, userSearchWhere, userTabWhere, isSuperRole, type UserFilter } from "./_shared";
export const dynamic = "force-dynamic";

const LIMIT = 200;

/**
 * Admin → Users (round 7, SPEC_R7 §5.1): the people who can sign in to the Admin Portal (role "admin") — never association members
 * or guests (those are in Members). Tabs All / Active / Inactive with counts, literal search on name and email, optional
 * ?role=<id> filter (from the Roles page), name order, at most 200 rows.
 */
export default async function AdminUsers({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string; f?: string; role?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "users", "view");
  const t = await getTranslations("adminUsers"); const ta = await getTranslations("admin");
  const sp = await searchParams;
  const filter: UserFilter = userFilter(sp.f);
  const needle = userQuery(sp.q);
  const roleId = idParam(sp.role);
  const role = roleId ? await db.adminRole.findUnique({ where: { id: roleId }, select: { id: true, name: true } }) : null;
  const scope = { AND: [USERS_BASE, userSearchWhere(needle), role ? { adminRoleId: role.id } : {}] };
  const countList = await Promise.all(USER_FILTERS.map((k) => db.user.count({ where: { AND: [scope, userTabWhere(k)] } })));
  const counts = Object.fromEntries(USER_FILTERS.map((k, i) => [k, countList[i]])) as Record<UserFilter, number>;
  const rows = await db.user.findMany({
    where: { AND: [scope, userTabWhere(filter)] }, orderBy: [{ name: "asc" }, { id: "asc" }], take: LIMIT,
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, adminRoleId: true, adminRole: { select: { id: true, name: true, isSystem: true, permissions: true } } },
  });
  const lockRows = rows.length ? await db.loginThrottle.findMany({ where: { key: { in: rows.map((r) => `e:${r.email}`) }, lockedUntil: { gt: new Date() } }, select: { key: true } }) : [];
  const locks = new Set(lockRows.map((r) => r.key.slice(2)));

  const canCreate = can(ctx, "users", "create"), canEdit = can(ctx, "users", "edit");
  const dl = dateLocale(locale);
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const L = (p: string) => `/${locale}${p}`;
  const href = (k: UserFilter, opts: { q?: string; role?: string | null } = {}) => {
    const s = new URLSearchParams(); const q = opts.q ?? needle; const r = opts.role === undefined ? role?.id : opts.role;
    if (k !== "all") s.set("f", k); if (q) s.set("q", q); if (r) s.set("role", r);
    const qs = s.toString(); return L(`/admin/users${qs ? `?${qs}` : ""}`);
  };
  const tabs: TabItem[] = USER_FILTERS.map((k) => ({ key: k, href: href(k), label: t(`f_${k}`), count: counts[k], current: filter === k }));
  const notice = sp.msg === "notFound" ? { cls: "alert-danger", text: t("notFound") } : null;
  const total = counts[filter];

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/users" />
      <main id="main" tabIndex={-1} className="app-main adm-users">
        <AdminHead title={t("title")} lead={t("lead")}
          actions={canCreate ? <a className="btn btn-primary btn-sm" href={L("/admin/users/new")} id="u-create"><Icon name="plus" size={16} />{t("newUser")}</a> : undefined} />
        {notice && <FocusOnLoad><div className={`alert ${notice.cls} adm-notice`} role="alert"><div>{notice.text}</div></div></FocusOnLoad>}
        <AdminTabs label={t("filterLabel")} items={tabs} />
        <div className="table-toolbar">
          <AdminSearch id="q" value={needle} label={t("search")} placeholder={t("searchPh")} hidden={{ f: filter !== "all" ? filter : undefined, role: role?.id }} button={t("search")} />
          <div className="toolbar-actions">
            {role && <span className="acc-filter-chip"><span>{t("roleFilter", { role: role.name })}</span>
              <a href={href(filter, { role: null })} aria-label={t("clearFilter")} title={t("clearFilter")}><Icon name="x" size={14} /></a></span>}
            <span className="small muted adm-count" role="status">{total > LIMIT ? t("showingFirst", { n: LIMIT, total }) : null}</span>
          </div>
        </div>
        {rows.length === 0 ? (
          needle ? <AdminEmpty title={t("empty")} action={<a className="btn btn-secondary btn-sm" href={href(filter, { q: "" })}>{t("clearSearch")}</a>}><q>{needle}</q></AdminEmpty>
            : <AdminEmpty title={filter === "inactive" ? t("emptyInactive") : t("empty")}
              action={role ? <a className="btn btn-secondary btn-sm" href={href(filter, { role: null })}>{t("clearFilter")}</a> : undefined}>
              {filter === "inactive" ? t("emptyInactiveHint") : null}</AdminEmpty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={ta("scrollRegion", { name: t("title") })}>
            <table className="adm-table adm-stack acc-table acc-users-table" data-testid="users-table">
              <caption className="sr-only">{t("title")}</caption>
              <thead><tr><th scope="col">{t("colUser")}</th><th scope="col" className="acc-col-role">{t("colRole")}</th><th scope="col" className="acc-col-status">{t("colStatus")}</th><th scope="col" className="adm-col-md-hide acc-col-created">{t("colCreated")}</th><th scope="col" className="adm-col-actions"><span className="sr-only">{ta("action")}</span></th></tr></thead>
              <tbody>
                {rows.map((u) => {
                  const self = u.id === ctx.user.id; const locked = locks.has(u.email);
                  // Manage = may change this account (oneself: the name; others: canManageUser, i.e. Super Admin or strictly fewer
                  // permissions, round-7 S1). Peers with equal permissions, stronger users and Super Admins (for non-supers) → View.
                  const manage = canEdit && (self || canManageUser(ctx, u));
                  return (
                    <tr key={u.id} className={u.active ? undefined : "is-inactive"} data-uid={u.id}>
                      <td data-label={t("colUser")} className="adm-cell-person"><div className="adm-who">
                        <Avatar name={u.name} size="sm" tone={isSuperRole(u.adminRoleId) ? "teal" : undefined} />
                        <div className="adm-person">
                          <span className="adm-name-line"><a href={L(`/admin/users/${encodeURIComponent(u.id)}`)}>{u.name}</a>{self && <span className="adm-you">{t("you")}</span>}</span>
                          <span className="small adm-email"><Email value={u.email} /></span>
                        </div>
                      </div></td>
                      <td data-label={t("colRole")}>{u.adminRole
                        ? <span className={`acc-role${isSuperRole(u.adminRole.id) ? " is-super" : ""}`}>{isSuperRole(u.adminRole.id) && <Icon name="shield" size={14} />}{u.adminRole.name}</span>
                        : <span className="muted">{t("noRole")}</span>}</td>
                      <td data-label={t("colStatus")}><span className="acc-statuses">
                        <span className={`status ${u.active ? "status-available" : "status-neutral"}`}>{u.active ? t("active") : t("inactive")}</span>
                        {locked && <span className="status status-danger">{t("locked")}</span>}
                      </span></td>
                      <td data-label={t("colCreated")} className="nowrap adm-col-md-hide">{day(u.createdAt)}</td>
                      <td className="adm-col-actions"><a className="btn btn-secondary btn-sm" href={L(`/admin/users/${encodeURIComponent(u.id)}`)}>{manage ? t("manage") : t("view")}</a></td>
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
