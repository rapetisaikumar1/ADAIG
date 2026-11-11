import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, getMessages, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { type Locale } from "@/config/site";
import { tierLookup, allTiers } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { auditLabel } from "@/lib/audit";
import { expireUnpaid, OPEN_STATUSES, REOPENABLE_STATUSES, renewalDayValue } from "@/lib/membership";
import { reviewEligibility, markRefunded, unlockAccount } from "../actions";
import { updateProfile, setUserRole, deleteUser, membershipAction, grantMembership, addCpe, updateCpe } from "./actions";
import { ProfileFields, TierOptions } from "../_fields";
import { statusFor } from "../_shared";
import { countryLabel } from "../countryNames";
import { subdivisionsFor } from "@/config/site";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Facet";
import { AdminHead, AdminReadOnly, AdminDl } from "../../_components/AdminUI";
import { TempPassword } from "./TempPassword";
export const dynamic = "force-dynamic";


/**
 * Admin → Members → one account: profile, role & access, memberships, CPE ledger, recent activity, deletion.
 * Association accounts only: an Admin Portal account is a 404 here (it is managed in Users). Forms are shown per permission
 * (members.edit: profile, access, memberships, CPE; members.delete: the danger zone); without them the page is read-only.
 */
export default async function AdminMember({ params, searchParams }: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const id = idParam((await params).id); // control characters / over-long → "" → not found
  const ctx = await requireAdminPermission(locale, "members", "view"); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers"); const tp = await getTranslations("profile");
  const { msg } = await searchParams;
  if (!id) notFound();
  // Admin Portal accounts are not Members records (managed in Users): 404 before anything (incl. lazy expiry) touches them.
  const pre = await db.user.findUnique({ where: { id }, select: { role: true } });
  if (!pre || pre.role === "admin") notFound();
  await expireUnpaid(id); // BUG-042 lazy expiry, as on the list
  const u = await db.user.findUnique({ where: { id }, include: { memberships: { orderBy: { createdAt: "desc" } }, cpe: { orderBy: { createdAt: "desc" }, include: { event: { select: { title: true } } } } } });
  if (!u || u.role === "admin") notFound();
  const canEdit = can(ctx, "members", "edit"), canDelete = can(ctx, "members", "delete");
  const deleted = u.role === "deleted";
  const lock = deleted ? null : await db.loginThrottle.findUnique({ where: { key: `e:${u.email}` } });
  const locked = !!lock?.lockedUntil && +lock.lockedUntil > Date.now();
  const ids = [u.id, ...u.memberships.map((m) => m.id)];
  const logs = await db.auditLog.findMany({ where: { OR: [{ target: { in: ids } }, { actor: u.id }, { target: `user:${u.id}` }] }, orderBy: { createdAt: "desc" }, take: 12 });
  const staffIds = [...new Set([...logs.map((l) => l.actor), ...u.cpe.map((c) => c.createdBy ?? ""), ...u.memberships.map((m) => m.verifiedBy ?? "")].filter(Boolean))];
  const staff = new Map((await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, role: true } })).map((s) => [s.id, s.role === "deleted" ? "—" : s.name]));

  const dl = dateLocale(locale); const et = t("et");
  const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone }) : "—");
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${et}`;
  const tx = (k: string) => (t.has(k) ? t(k) : k.replace(/^\w+_/, ""));
  const logLabel = (a: string) => auditLabel(t, a);
  const getTier = await tierLookup(); const tierName = (tid: string) => getTier(tid)?.name[locale] ?? tid; // admin-editable names (Admin → Settings)
  // An application note belongs to the tier applied for: after a change to a tier without an eligibility check it is marked "earlier".
  const note = (m: { tierId: string; eligibilityNote: string | null }) => !m.eligibilityNote ? null : getTier(m.tierId)?.requiresVerification ? m.eligibilityNote : t("noteEarlier", { note: m.eligibilityNote });
  // Guest or member follows the memberships (approve / add → member; last active one ends → guest); only admin is set by hand.
  const derivedRole = u.memberships.some((m) => m.status === "active") ? "member" : "guest";
  const clientMessages = Object.fromEntries(Object.entries(await getMessages()).filter(([k]) => k === "admin" || k === "adminMembers"));
  const tiers = (await allTiers()).map((x) => ({ id: x.id, name: x.name[locale] ?? x.name.en }));
  const notice = msg && /^(msg|err)_\w+$/.test(msg) && tm.has(msg) ? { cls: msg.startsWith("err_") ? "alert-danger" : "alert-success", text: tm(msg) } : null;
  const subs = subdivisionsFor(u.country); const sub = subs?.find((p) => p.code === u.province);
  const province = sub ? (locale === "fr" ? sub.nameFr : sub.name) : u.province; // read-only profile (no members.edit)
  const mActions = canEdit && !deleted; // membership and CPE controls
  const hasOpen = u.memberships.some((m) => (OPEN_STATUSES as readonly string[]).includes(m.status));
  const cpeApproved = u.cpe.filter((c) => c.status === "approved").reduce((a, c) => a + c.hours, 0);
  const minDay = renewalDayValue(new Date(Date.now() + 864e5));
  const hid = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="uid" value={u.id} /></>;
  const mh = (mid: string) => <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={mid} /></>;
  const back = (mid: string) => <>{mh(mid)}<input type="hidden" name="ret" value="detail" /></>; // existing list actions, returning here
  const L = (p: string) => `/${locale}${p}`;

  const confirm = (summary: React.ReactNode, cls: string, body: React.ReactNode, label?: string) => (
    <details className="confirm adm-confirm"><summary className={`btn ${cls} btn-sm`} aria-label={label}>{summary}</summary>{body}</details>
  );
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" tabIndex={-1} className="app-main adm-mbr">
        <AdminHead back={{ href: L("/admin/members"), label: t("membersTitle") }}
          media={<Avatar name={deleted ? "?" : u.name} />}
          title={deleted ? tm("deletedName") : u.name}
          meta={<>{!deleted && <span className="adm-email">{u.email}</span>}<span className="badge">{tx(`role_${u.role}`)}</span>{locked && <span className="status status-danger">{t("locked")}</span>}</>} />
        {notice && <FocusOnLoad><div className={`alert ${notice.cls} adm-notice`} role={notice.cls === "alert-danger" ? "alert" : "status"}><div>{notice.text}</div></div></FocusOnLoad>}
        {!deleted && !canEdit && !canDelete && <AdminReadOnly text={t("readOnly")} />}
        {deleted && <div className="alert alert-info adm-notice" role="status"><div><b>{tm("deletedTitle")}</b>{tm("deletedBody", { date: day(u.deletedAt) })}</div></div>}

        <div className="adm-sheet adm-mbr-sheet">
          {!deleted && canEdit && <form action={updateProfile} className="settings-section" id="profile" aria-labelledby="h-profile">
            {hid}
            <header><h2 id="h-profile">{tm("profileTitle")}</h2><p>{tm("joinedOn", { date: day(u.createdAt) })}</p></header>
            <div className="adm-fields">
              <ProfileFields t={(k) => tm(k)} locale={locale} idp="p" d={u} />
              <div className="save-row"><button className="btn btn-accent btn-sm">{tm("saveProfile")}</button></div>
            </div>
          </form>}
          {!deleted && !canEdit && <section className="settings-section" id="profile" aria-labelledby="h-profile">
            <header><h2 id="h-profile">{tm("profileTitle")}</h2><p>{tm("joinedOn", { date: day(u.createdAt) })}</p></header>
            {/* Read-only profile (VIS m6): the same label-over-value grid as the other read-only details. */}
            <div className="adm-fields"><AdminDl notSet={t("notSet")} items={([
                ["f_name", u.name], ["f_email", u.email], ["f_org", u.organisation], ["f_job", u.jobTitle],
                ["f_country", countryLabel(u.country, locale)], ["f_province", province],
                ["f_directory", tm(u.directoryOptIn ? "ro_yes" : "ro_no")], ["f_marketing", tm(u.marketingOptIn ? "ro_yes" : "ro_no")],
              ] as const).map(([k, v]) => ({ key: k, label: tm(k), value: v }))} /></div>
          </section>}

          {!deleted && <section className="settings-section" id="account" aria-labelledby="h-account">
            <header><h2 id="h-account">{tm("accountTitle")}</h2></header>
            <div className="adm-fields">
              <div className="adm-sub">
                <h3>{t("role")}</h3>
                <div className="adm-actions">
                  <span className="badge">{tx(`role_${u.role}`)}</span>
                  {canEdit && u.role !== derivedRole && <form action={setUserRole}>{hid}<input type="hidden" name="role" value={derivedRole} /><button className="btn btn-secondary btn-sm">{tm("syncRole", { role: tx(`role_${derivedRole}`) })}</button></form>}
                </div>
                <p className="hint">{tm("roleHint")}</p>
              </div>
              <div className="adm-sub">
                <h3>{tm("signInTitle")}</h3>
                {locked ? <div className="adm-actions"><span className="status status-danger">{t("locked")}</span><span className="small">{tm("lockedUntil", { time: stamp(lock!.lockedUntil!) })}</span>
                  {canEdit && <form action={unlockAccount}>{back(u.id)}<button className="btn btn-secondary btn-sm">{t("unlock")}</button></form>}</div>
                  : <p className="small">{lock?.failures ? tm("notLockedFailures", { n: lock.failures }) : tm("notLocked")}</p>}
              </div>
              {canEdit && <div className="adm-sub"><NextIntlClientProvider messages={clientMessages}><TempPassword locale={locale} uid={u.id} /></NextIntlClientProvider></div>}
            </div>
          </section>}

          <section className="settings-section is-wide" id="memberships" aria-labelledby="h-ms">
            <header><h2 id="h-ms">{tm("membershipsTitle")}</h2><p>{tm("membershipsHint")}</p></header>
            <div className="adm-fields">
            {u.memberships.length === 0 ? <p className="adm-empty-inline">{t("noMembership")}</p> : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("scrollRegion", { name: tm("membershipsTitle") })}><table className="adm-table adm-stack adm-mbr-table adm-stack-md"><caption className="sr-only">{tm("membershipsTitle")}</caption>
                <thead><tr><th scope="col">{t("tier")}</th><th scope="col">{t("status")}</th><th scope="col">{tm("dates")}</th>{mActions && <th scope="col" className="adm-col-actions">{t("action")}</th>}</tr></thead><tbody>
                {u.memberships.map((m) => { const open = (OPEN_STATUSES as readonly string[]).includes(m.status); const reopen = (REOPENABLE_STATUSES as readonly string[]).includes(m.status); return (
                  <tr key={m.id} className={m.status === "pending_verification" ? "is-pending" : undefined}>
                    <td data-label={t("tier")}><div className="adm-person"><b>{tierName(m.tierId)}</b>{note(m) && <span className="small muted">{note(m)}</span>}{m.paymentRef && <span className="small muted">{tm("paid")}</span>}</div></td>
                    <td data-label={t("status")}><div className="adm-person"><span><span className={`status ${statusFor(m.status)}`}>{tx(`status_${m.status}`)}</span></span>
                      {m.refundStatus === "refund_due" && <span><span className="status status-pending">{t("refundDue")}</span></span>}{m.refundStatus === "refunded" && <span><span className="status status-available">{t("refunded")}</span></span>}
                      {m.rejectionReason && <span className="small muted">{m.rejectionReason}</span>}</div></td>
                    <td data-label={tm("dates")}><dl className="adm-mbr-dl">
                      {/* Staff-added or imported rows are recorded after they started: "Recorded", not "Applied". */}
                      <div><dt>{m.startsAt && +m.createdAt > +m.startsAt ? tm("recorded") : t("applied")}</dt><dd>{day(m.createdAt)}</dd></div>
                      {m.startsAt && <div><dt>{tm("starts")}</dt><dd>{day(m.startsAt)}</dd></div>}
                      {m.renewsAt && <div><dt>{tm("renews")}</dt><dd>{day(m.renewsAt)}</dd></div>}
                      {m.verifiedBy && <div><dt>{tm("decidedBy")}</dt><dd>{staff.get(m.verifiedBy) ?? m.verifiedBy}</dd></div>}
                    </dl></td>
                    {mActions && <td data-label={t("action")} className="adm-col-actions"><div className="adm-actions adm-actions-wrap">
                      {m.status === "pending_verification" && <>
                        <form action={reviewEligibility}>{back(m.id)}<input type="hidden" name="decision" value="approve" /><button className="btn btn-accent btn-sm"><Icon name="check" size={16} />{t("approve")}</button></form>
                        {confirm(<>{t("reject")}…</>, "btn-secondary",
                          <form action={reviewEligibility} className="confirm-box">{back(m.id)}<input type="hidden" name="decision" value="reject" /><div className="field"><label htmlFor={`rr-${m.id}`}>{t("reasonLabel")}</label><input id={`rr-${m.id}`} name="reason" type="text" placeholder={t("reasonPh")} maxLength={300} /></div><div className="confirm-actions"><button className="btn btn-danger btn-sm">{t("confirmReject")}</button></div></form>)}</>}
                      {m.status === "active" && confirm(<>{tm("renewal")}…</>, "btn-secondary",
                        <form action={membershipAction} className="confirm-box">{mh(m.id)}<input type="hidden" name="op" value="renewal" /><div className="field"><label htmlFor={`rn-${m.id}`}>{tm("renewsOn")} <span className="optional">({et})</span></label><input id={`rn-${m.id}`} name="renewsOn" type="date" required min={minDay} defaultValue={m.renewsAt ? renewalDayValue(m.renewsAt) : undefined} /></div><div className="confirm-actions"><button className="btn btn-accent btn-sm">{tm("saveRenewal")}</button></div></form>)}
                      {open && confirm(<>{tm("changeTier")}…</>, "btn-secondary",
                        <form action={membershipAction} className="confirm-box">{mh(m.id)}<input type="hidden" name="op" value="tier" /><div className="field"><label htmlFor={`ti-${m.id}`}>{t("tier")}</label><select id={`ti-${m.id}`} name="tier" defaultValue={m.tierId}><TierOptions list={tiers} /></select></div><div className="confirm-actions"><button className="btn btn-accent btn-sm">{tm("saveTier")}</button></div></form>)}
                      {m.status === "active" && confirm(<>{tm("markLapsed")}…</>, "btn-danger-outline",
                        <form action={membershipAction} className="confirm-box">{mh(m.id)}<input type="hidden" name="op" value="lapse" /><p>{tm("lapseConfirm")}</p><label className="check"><input type="checkbox" name="confirm" required /> <span>{tm("confirmBox")}</span></label><div className="confirm-actions"><button className="btn btn-danger btn-sm">{tm("markLapsedYes")}</button></div></form>)}
                      {open && confirm(<>{tm("cancelMembership")}…</>, "btn-danger-outline",
                        <form action={membershipAction} className="confirm-box">{mh(m.id)}<input type="hidden" name="op" value="cancel" /><p>{tm("cancelConfirm")}</p><label className="check"><input type="checkbox" name="confirm" required /> <span>{tm("confirmBox")}</span></label><div className="confirm-actions"><button className="btn btn-danger btn-sm">{tm("cancelYes")}</button></div></form>)}
                      {reopen && (hasOpen ? <span className="small muted">{tm("reopenBlocked")}</span> : confirm(<>{tm("reactivate")}…</>, "btn-secondary",
                        <form action={membershipAction} className="confirm-box">{mh(m.id)}<input type="hidden" name="op" value="reactivate" /><div className="field"><label htmlFor={`ra-${m.id}`}>{tm("renewsOn")} <span className="optional">({tm("defaultOneYear")})</span></label><input id={`ra-${m.id}`} name="renewsOn" type="date" min={minDay} /></div><div className="confirm-actions"><button className="btn btn-accent btn-sm">{tm("reactivateYes")}</button></div></form>))}
                      {m.refundStatus === "refund_due" && confirm(<>{t("markRefunded")}…</>, "btn-secondary",
                        <form action={markRefunded} className="confirm-box">{back(m.id)}<p>{t("markRefundedConfirm", { name: u.name })}</p><div className="confirm-actions"><button className="btn btn-primary btn-sm">{t("markRefundedYes")}</button></div></form>)}
                      {!open && !reopen && m.refundStatus !== "refund_due" && <span className="muted adm-dash">—</span>}
                    </div></td>}
                  </tr>
                ); })}
              </tbody></table></div>)}
            {mActions && !hasOpen && <form action={grantMembership} className="adm-grant">{hid}
              <h3 className="adm-sub-h">{tm("grantTitle")}</h3>
              <p className="hint">{tm("grantHint")}</p>
              <div className="adm-inline">
                <div className="field"><label htmlFor="g-tier">{t("tier")}</label><select id="g-tier" name="tier" required defaultValue=""><option value="" disabled>{tm("chooseTier")}</option><TierOptions list={tiers} /></select></div>
                <div className="field"><label htmlFor="g-renew">{tm("renewsOn")} <span className="optional">({tm("defaultOneYear")})</span></label><input id="g-renew" name="renewsOn" type="date" min={minDay} /></div>
                <button className="btn btn-accent">{tm("grantButton")}</button>
              </div>
            </form>}
            </div>
          </section>

          {!deleted && <section className="settings-section is-wide" id="cpe" aria-labelledby="h-cpe">
            <header><h2 id="h-cpe">{tm("cpeTitle")}</h2><p>{tm("cpeTotal", { n: Math.round(cpeApproved * 100) / 100 })}</p></header>
            <div className="adm-fields">
            {u.cpe.length === 0 ? <p className="adm-empty-inline">{tm("cpeNone")}</p> : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("scrollRegion", { name: tm("cpeTitle") })}><table className="adm-table adm-stack adm-mbr-cpe adm-stack-md"><caption className="sr-only">{tm("cpeTitle")}</caption>
                <thead><tr><th scope="col">{tm("cpeEntry")}</th><th scope="col" className="num">{tm("cpeHours")}</th><th scope="col">{tm("cpeAdded")}</th><th scope="col">{t("status")}</th>{mActions && <th scope="col" className="adm-col-actions">{t("action")}</th>}</tr></thead><tbody>
                {u.cpe.map((c) => (
                  <tr key={c.id}>
                    <td data-label={tm("cpeEntry")}><div className="adm-person"><b>{c.title}</b>{c.eventId && <span className="small muted">{tm("cpeFromEvent")}</span>}{c.createdBy && <span className="small muted">{tm("cpeBy", { name: staff.get(c.createdBy) ?? c.createdBy })}</span>}</div></td>
                    <td className="num" data-label={tm("cpeHours")}>{c.hours}</td>
                    <td className="nowrap" data-label={tm("cpeAdded")}>{day(c.createdAt)}</td>
                    <td data-label={t("status")}>{!mActions ? tm(`cpe_${c.status}` as "cpe_approved") : <form action={updateCpe} className="adm-inline">{mh(c.id)}
                      <label htmlFor={`cs-${c.id}`} className="sr-only">{t("status")}</label><select id={`cs-${c.id}`} name="status" defaultValue={c.status}>{["submitted", "approved", "audit"].map((s) => <option key={s} value={s}>{tm(`cpe_${s}` as "cpe_approved")}</option>)}</select>
                      <button className="btn btn-secondary btn-sm">{tm("cpeUpdate")}</button></form>}</td>
                    {mActions && <td className="adm-col-actions">{confirm(<>{tm("cpeRemove")}…</>, "btn-ghost adm-danger-ghost",
                      <form action={updateCpe} className="confirm-box">{mh(c.id)}<input type="hidden" name="op" value="remove" /><p>{tm("cpeRemoveConfirm")}</p><div className="confirm-actions"><button className="btn btn-danger btn-sm">{tm("cpeRemoveYes")}</button></div></form>, `${tm("cpeRemove")}: ${c.title}`)}</td>}
                  </tr>
                ))}
              </tbody></table></div>)}
            {mActions && <form action={addCpe} className="adm-grant">{hid}
              <h3 className="adm-sub-h">{tm("cpeAddTitle")}</h3>
              <div className="adm-inline">
                <div className="field adm-grow"><label htmlFor="c-title">{tm("cpeEntry")}</label><input id="c-title" name="title" type="text" required maxLength={200} /></div>
                <div className="field"><label htmlFor="c-hours">{tm("cpeHours")}</label><input id="c-hours" name="hours" type="number" required min={0.25} max={100} step={0.25} defaultValue={1} style={{ width: 110 }} /></div>
                <div className="field"><label htmlFor="c-status">{t("status")}</label><select id="c-status" name="status" defaultValue="approved">{["submitted", "approved", "audit"].map((s) => <option key={s} value={s}>{tm(`cpe_${s}` as "cpe_approved")}</option>)}</select></div>
                <button className="btn btn-accent">{tm("cpeAdd")}</button>
              </div>
            </form>}
            </div>
          </section>}

          <section className="settings-section is-wide" aria-labelledby="h-act">
            <header><h2 id="h-act">{tm("activityTitle")}</h2>{!deleted && can(ctx, "system", "view") && <a className="small link-arrow" href={L(`/admin/audit?target=${encodeURIComponent(u.id)}`)}>{tm("fullLog")}</a>}</header>
            <div className="adm-fields">
            {logs.length ? <ul className="adm-log">{logs.map((l) => <li key={l.id}><span>{logLabel(l.action)}<span className="small muted"> · {l.actor === u.id ? tm("byThem") : staff.get(l.actor) ?? l.actor}</span></span><time className="small muted" dateTime={l.createdAt.toISOString()}>{stamp(l.createdAt)}</time></li>)}</ul>
              : <p className="adm-empty-inline">{t("noActivity")}</p>}
            </div>
          </section>
        </div>

        {!deleted && canDelete && <form action={deleteUser} className="panel danger-zone" id="delete" aria-labelledby="h-del">{hid}<div className="settings-section">
          <header><p className="danger-zone-label"><Icon name="alert" size={16} />{tp("dangerLabel")}</p><h2 id="h-del">{tm("deleteTitle")}</h2></header>
          <div className="adm-fields"><p>{tm("deleteBody")}</p>
            <div className="save-row"><label className="check"><input type="checkbox" name="confirm" required /> <span>{tm("deleteConfirm", { name: u.name })}</span></label>
                <button className="btn btn-danger-outline"><Icon name="trash" size={18} />{tm("deleteButton")}</button></div>
          </div>
        </div>
        </form>}
      </main>
    </div>
  );
}
