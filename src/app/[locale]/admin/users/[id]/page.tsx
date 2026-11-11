import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, getMessages, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { can, canAssignRole, canManageUser, requireAdminPermission } from "@/lib/rbac";
import { SUPER_ADMIN_ROLE_ID, effectivePermissions, isSubset } from "@/lib/permissions";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Facet";
import { AdminHead } from "../../_components/AdminUI";
import { type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { auditLabel } from "@/lib/audit";
import { updateAdminUser, changeAdminUserRole, setAdminUserActive, unlockAdminUser } from "../actions";
import { roleOrder, isSuperRole } from "../_shared";
import { ResetPasswordForm } from "./ResetPasswordForm";
export const dynamic = "force-dynamic";

/**
 * Admin → Users → one Admin Portal account (SPEC_R7 §5.1): details, role, account status, password reset, membership note, recent
 * activity. Controls are shown only when the viewer may use them (users.edit, §3.4 rules 3 and 6); otherwise the values are shown
 * as text with a note saying why. The server actions enforce the same rules.
 */
export default async function AdminUser({ params, searchParams }: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const id = idParam((await params).id);
  const ctx = await requireAdminPermission(locale, "users", "view");
  const t = await getTranslations("adminUsers"); const ta = await getTranslations("admin");
  const { msg } = await searchParams;
  if (!id) notFound();
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true, active: true, createdAt: true, adminRoleId: true,
      adminRole: { select: { id: true, name: true, description: true, isSystem: true, permissions: true } },
      memberships: { orderBy: { createdAt: "desc" }, take: 1, select: { tierId: true, status: true } },
    },
  });
  if (!u || u.role !== "admin") notFound(); // Members accounts are managed in Members (D1 separation)

  const self = u.id === ctx.user.id;
  const canEdit = can(ctx, "users", "edit");
  // §3.4 rule 6 as tightened in round 7 (S1): canManageUser decides (Super Admin, or a target whose permissions are a strict subset).
  const editOthers = canEdit && !self && canManageUser(ctx, u); // role, status, password, unlock, email: never oneself
  const editDetails = canEdit && (self || editOthers); // oneself: the name only (S2: the email is changed by another admin)
  const targetSuper = isSuperRole(u.adminRoleId);
  // A peer: not a Super Admin, and the same permissions as the viewer (a subset that is not strict) → View, with its own note.
  const peer = canEdit && !self && !editOthers && !targetSuper && isSubset(effectivePermissions(u.adminRole), ctx.permissions);
  const [lock, otherSupers, roleList] = await Promise.all([
    db.loginThrottle.findUnique({ where: { key: `e:${u.email}` } }),
    db.user.count({ where: { role: "admin", active: true, adminRoleId: SUPER_ADMIN_ROLE_ID, id: { not: u.id } } }),
    editOthers ? db.adminRole.findMany({ select: { id: true, name: true, isSystem: true, permissions: true } }) : Promise.resolve([]),
  ]);
  const locked = !!lock?.lockedUntil && +lock.lockedUntil > Date.now();
  const lastSuper = targetSuper && u.active && otherSupers === 0;
  const roles = roleOrder(roleList.filter((r) => canAssignRole(ctx, r) || r.id === u.adminRoleId));

  const logs = await db.auditLog.findMany({
    where: { OR: [{ target: u.id }, { target: { startsWith: `${u.id} (` } }, { actor: u.id }, { target: u.email }] },
    orderBy: { createdAt: "desc" }, take: 12,
  });
  const actorIds = [...new Set(logs.map((l) => l.actor).filter((a) => a !== u.id))];
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } })).map((s) => [s.id, s.role === "deleted" ? "—" : s.name]));
  const m = u.memberships[0];
  const getTier = m ? await tierLookup() : null;

  const dl = dateLocale(locale);
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${ta("et")}`;
  const L = (p: string) => `/${locale}${p}`;
  const notice = msg && /^(msg|err)_\w+$/.test(msg) && t.has(msg) ? { err: msg.startsWith("err_"), text: t(msg) } : null;
  const hid = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="uid" value={u.id} /></>;
  const statusChip = <span className={`status ${u.active ? "status-available" : "status-neutral"}`}>{u.active ? t("active") : t("inactive")}</span>;
  const roleChip = u.adminRole
    ? <span className={`acc-role${targetSuper ? " is-super" : ""}`}>{targetSuper && <Icon name="shield" size={14} />}{u.adminRole.name}</span>
    : <span className="acc-role is-none">{t("noRole")}</span>;
  // Why role/status/password controls are not offered (§3.4): oneself, a Super Admin, someone with more permissions, or view-only.
  const whyNot = self ? t("selfNote") : !canEdit ? ta("readOnly") : targetSuper ? t("superNote") : peer ? t("peerNote") : t("targetNote");
  const blocked = !self && !editOthers; // someone else the viewer can't change: one banner explains why, values shown as text
  const why = (text: string) => <p className="acc-why"><Icon name="lock" size={16} /><span>{text}</span></p>;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/users" />
      <main id="main" tabIndex={-1} className={`app-main adm-users acc-user${u.active ? "" : " is-inactive"}`}>
        <AdminHead back={{ href: L("/admin/users"), label: t("title") }}
          media={<Avatar name={u.name} tone={targetSuper ? "teal" : undefined} />}
          title={u.name}
          meta={<><span className="adm-email">{u.email}</span>{roleChip}{statusChip}{locked && <span className="status status-danger">{t("locked")}</span>}{self && <span className="adm-you">{t("you")}</span>}</>} />
        {notice && <FocusOnLoad><div className={`alert ${notice.err ? "alert-danger" : "alert-success"} adm-notice`} role={notice.err ? "alert" : "status"}><div>{notice.text}</div></div></FocusOnLoad>}
        {!u.active && <div className="alert alert-warning adm-notice acc-banner" role="note"><Icon name="alert" size={20} /><div>{t("inactiveBanner")}</div></div>}
        {self && <div className="alert alert-info adm-notice acc-banner" role="note" data-testid="self-note"><Icon name="info" size={20} />
          <div><p>{t("selfNote")}</p><p className="acc-banner-link"><a className="link-arrow" href={L("/my/profile")}>{t("profileLink")}</a></p></div></div>}
        {blocked && <div className="alert alert-info adm-notice acc-banner" role="note" data-testid="blocked-note"><Icon name="lock" size={20} /><div>{whyNot}</div></div>}

        <div className="adm-sheet">
          {/* Details */}
          {editDetails ? (
            <form action={updateAdminUser} className="settings-section" id="details" aria-labelledby="h-details">
              {hid}
              <header><h2 id="h-details">{t("detailsTitle")}</h2><p>{t("createdOn", { date: day(u.createdAt) })}</p></header>
              <div className="adm-fields">
                <div className="adm-form-grid">
                  <div className="field"><label htmlFor="d-name">{t("f_name")}</label><input id="d-name" name="name" type="text" autoComplete="off" required maxLength={100} defaultValue={u.name} /></div>
                  {/* S2: your own sign-in email is read-only here (the server refuses a forged change too); another admin changes it. */}
                  <div className="field"><label htmlFor="d-email">{t("f_email")}</label>
                    {self
                      ? <span className="acc-ro"><input id="d-email" name="email" type="email" readOnly value={u.email} aria-describedby="d-email-h" /><Icon name="lock" size={16} /></span>
                      : <input id="d-email" name="email" type="email" autoComplete="off" spellCheck={false} required maxLength={254} defaultValue={u.email} aria-describedby="d-email-h" />}
                    <span className="hint" id="d-email-h">{self ? t("emailHintSelf") : t("emailHintOther")}</span></div>
                </div>
                <div className="save-row"><button className="btn btn-accent">{t("saveDetails")}</button></div>
              </div>
            </form>
          ) : (
            <section className="settings-section" id="details" aria-labelledby="h-details">
              <header><h2 id="h-details">{t("detailsTitle")}</h2><p>{t("createdOn", { date: day(u.createdAt) })}</p></header>
              <div className="adm-fields">
                <dl className="acc-dl"><div><dt>{t("f_name")}</dt><dd>{u.name}</dd></div><div><dt>{t("f_email")}</dt><dd>{u.email}</dd></div></dl>
              </div>
            </section>
          )}

          {/* Role */}
          <section className="settings-section" id="role" aria-labelledby="h-role">
            <header><h2 id="h-role">{t("roleTitle")}</h2><p>{t("roleHint")}</p></header>
            <div className="adm-fields">
              {editOthers && !lastSuper ? (
                <form action={changeAdminUserRole} className="acc-inline-form">
                  {hid}
                  <div className="field"><label htmlFor="u-role-change">{t("f_role")}</label>
                    <select id="u-role-change" name="roleId" required defaultValue={u.adminRoleId ?? ""} aria-describedby="u-role-change-h">
                      {!u.adminRoleId && <option value="" disabled>{t("chooseRole")}</option>}
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select></div>
                  <button className="btn btn-accent">{t("changeRole")}</button>
                  <p className="hint acc-inline-hint" id="u-role-change-h">{t("roleChangeHint")}</p>
                </form>
              ) : (
                <>
                  <div className="acc-current"><span className="acc-current-label">{t("currentRole")}</span>{roleChip}</div>
                  {u.adminRole?.description && <p className="small muted acc-role-desc">{u.adminRole.description}</p>}
                  {editOthers && lastSuper ? why(t("lastSuperNote")) : null}
                </>
              )}
              {u.adminRole && can(ctx, "roles", "view") && <p className="small"><a className="link-arrow" href={L(`/admin/roles/${encodeURIComponent(u.adminRole.id)}`)}>{t("viewRole", { role: u.adminRole.name })}</a></p>}
            </div>
          </section>

          {/* Account status */}
          <section className="settings-section" id="status" aria-labelledby="h-status">
            <header><h2 id="h-status">{t("statusTitle")}</h2><p>{t("statusHint")}</p></header>
            <div className="adm-fields">
              <p className={`acc-state ${u.active ? "is-on" : "is-off"}`}>{u.active ? t("statusActive") : t("statusInactive")}</p>
              {locked && (
                <div className="acc-current">
                  <span className="status status-danger">{t("locked")}</span>
                  <span className="small">{t("lockedUntil", { time: stamp(lock!.lockedUntil!) })}</span>
                  {editOthers && <form action={unlockAdminUser}>{hid}<button className="btn btn-secondary">{t("unlock")}</button></form>}
                </div>
              )}
              {editOthers && !lastSuper ? (
                u.active ? (
                  <details className="confirm adm-confirm acc-deactivate">
                    <summary className="btn btn-danger-outline">{t("deactivate")}…</summary>
                    <form action={setAdminUserActive} className="confirm-box">
                      {hid}<input type="hidden" name="to" value="inactive" />
                      <p>{t("deactivateConfirm", { name: u.name })}</p>
                      <label className="check"><input type="checkbox" name="confirm" required /> <span>{t("deactivateCheck")}</span></label>
                      {/* DESIGN_R5 §10.5: outline until its own confirm box is ticked (CSS :has, admin-access.css) */}
                      <div className="confirm-actions"><button className="btn btn-danger-outline">{t("deactivateYes")}</button></div>
                    </form>
                  </details>
                ) : (
                  <form action={setAdminUserActive}>{hid}<input type="hidden" name="to" value="active" /><button className="btn btn-accent"><Icon name="refresh" size={18} />{t("activate")}</button></form>
                )
              ) : editOthers && lastSuper ? why(t("lastSuperNote")) : null}
            </div>
          </section>

          {/* Reset password: only when the viewer may reset it. Oneself → the banner links to Profile & privacy; others → the banner says why. */}
          {editOthers && <section className="settings-section" id="password" aria-labelledby="h-password">
            <header><h2 id="h-password">{t("pwTitle")}</h2><p>{t("pwResetHint")}</p></header>
            <div className="adm-fields">
              <NextIntlClientProvider messages={Object.fromEntries(Object.entries(await getMessages()).filter(([k]) => k === "adminUsers"))}>
                <ResetPasswordForm locale={locale} uid={u.id} />
              </NextIntlClientProvider>
            </div>
          </section>}

          {m && (
            <section className="settings-section" aria-labelledby="h-membership">
              <header><h2 id="h-membership">{t("membershipTitle")}</h2></header>
              <div className="adm-fields"><p className="small">{t("membershipNote", { tier: getTier?.(m.tierId)?.name[locale] ?? m.tierId, status: ta.has(`status_${m.status}`) ? ta(`status_${m.status}`) : m.status })}</p></div>
            </section>
          )}

          <section className="settings-section is-wide" id="activity" aria-labelledby="h-activity">
            <header><h2 id="h-activity">{t("activityTitle")}</h2>{can(ctx, "system", "view") && <a className="small link-arrow" href={L(`/admin/audit?target=${encodeURIComponent(u.id)}`)}>{t("fullLog")}</a>}</header>
            <div className="adm-fields">
              {logs.length ? (
                <ul className="adm-log">{logs.map((l) => (
                  <li key={l.id}><span>{auditLabel(ta, l.action)}{l.actor === u.id ? <span className="small muted"> · {self ? t("byYou") : t("byThem")}</span> : actors.has(l.actor) ? <span className="small muted"> · {actors.get(l.actor)}</span> : null}</span>
                    <time className="small muted" dateTime={l.createdAt.toISOString()}>{stamp(l.createdAt)}</time></li>
                ))}</ul>
              ) : <p className="adm-empty-inline">{t("noActivity")}</p>}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
