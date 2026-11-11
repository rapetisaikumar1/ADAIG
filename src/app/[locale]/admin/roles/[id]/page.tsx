import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, getMessages, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { can, canManageRole, requireAdminPermission } from "@/lib/rbac";
import { MODULES, effectivePermissions, isSubset } from "@/lib/permissions";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { AdminHead, AdminReadOnly } from "../../_components/AdminUI";
import { type Locale } from "@/config/site";
import { updateRole, deleteRole } from "../actions";
import { RoleForm } from "../RoleForm";
export const dynamic = "force-dynamic";

/**
 * Admin → Roles → one role (roles.view). Editable only with roles.edit and when the role is manageable (§3.4 r7): never the
 * Super Admin system role, never your own role, never a role with permissions you don't hold — otherwise read-only with the reason.
 * Danger zone (roles.delete): disabled with the user count while anyone has the role (rule 8).
 */
export default async function AdminRole({ params, searchParams }: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "roles", "view");
  const id = idParam((await params).id);
  if (!id) notFound();
  const role = await db.adminRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) notFound();
  const t = await getTranslations("adminRoles"); const ta = await getTranslations("admin"); const tp = await getTranslations("profile");
  const { msg } = await searchParams;
  const L = (p: string) => `/${locale}${p}`;

  const perms = effectivePermissions(role);
  const initial = MODULES.flatMap((m) => (perms[m] ?? []).map((a) => `${m}:${a}`));
  const own = ctx.role?.id === role.id;
  const manageable = canManageRole(ctx, role);
  const editable = can(ctx, "roles", "edit") && manageable;
  const deletable = can(ctx, "roles", "delete") && manageable;
  const n = role._count.users;
  const usersHref = L(`/admin/users?role=${encodeURIComponent(role.id)}`);
  const canUsers = can(ctx, "users", "view");
  // Why the form is read-only (the server refuses the same cases): system role, own role, more powerful role, or no roles.edit.
  const note = role.isSystem ? t("superNote") : own ? t("ownRoleNote") : !isSubset(perms, ctx.permissions) ? t("targetNote") : !editable ? ta("readOnly") : null;
  const notice = msg && /^(msg|err)_\w+$/.test(msg) && t.has(msg) ? { cls: msg.startsWith("err_") ? "alert-danger" : "alert-success", text: t(msg) } : null;
  const hid = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={role.id} /></>;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/roles" />
      <main id="main" tabIndex={-1} className="app-main rl-page">
        <AdminHead back={{ href: L("/admin/roles"), label: t("title") }} title={role.name}
          meta={<>
            {role.isSystem && <span className="badge rl-system"><Icon name="shield" size={14} />{t("system")}</span>}
            {own && <span className="adm-you">{t("yourRole")}</span>}
            {canUsers && n > 0 ? <a className="small" href={usersHref}>{t("usersN", { n })}</a> : <span className="small muted">{t("usersN", { n })}</span>}
          </>} />
        {notice && <FocusOnLoad><div className={`alert ${notice.cls} adm-notice`} role={notice.cls === "alert-danger" ? "alert" : "status"}><div>{notice.text}</div></div></FocusOnLoad>}
        {note && <AdminReadOnly text={note} icon={role.isSystem ? "shield" : "lock"} className="rl-note" />}

        <NextIntlClientProvider messages={Object.fromEntries(Object.entries(await getMessages()).filter(([k]) => k === "adminRoles"))}>
          <RoleForm key={role.updatedAt.toISOString()} locale={locale} action={editable ? updateRole : undefined}
            role={{ id: role.id, v: role.updatedAt.toISOString(), name: role.name, description: role.description ?? "" }}
            initial={initial} actor={ctx.permissions} cancelHref={L("/admin/roles")} submitLabel={t("save")} />
        </NextIntlClientProvider>

        {deletable && (
          <section className="panel danger-zone" id="delete" aria-labelledby="h-del">
            <div className="settings-section">
              <header><p className="danger-zone-label"><Icon name="alert" size={16} />{tp("dangerLabel")}</p><h2 id="h-del">{t("deleteTitle")}</h2></header>
              <div className="adm-fields">
                <p>{t("deleteBody")}</p>
                {n > 0 ? (
                  <div className="save-row rl-del-blocked">
                    <p className="save-row-note" id="rl-del-why">{t("deleteInUse", { n })}{canUsers && <> <a href={usersHref}>{t("viewUsers")}</a></>}</p>
                    <button type="button" className="btn btn-danger-outline" disabled aria-describedby="rl-del-why"><Icon name="trash" size={18} />{t("deleteButton")}</button>
                  </div>
                ) : (
                  <form action={deleteRole} className="save-row">{hid}
                    <label className="check"><input type="checkbox" name="confirm" required /> <span>{t("deleteConfirm")}</span></label>
                    <button className="btn btn-danger-outline"><Icon name="trash" size={18} />{t("deleteButton")}</button>
                  </form>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
