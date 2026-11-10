import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { cpeCycleTarget, type Locale } from "@/config/site";
import { tierLookup, allTiers } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
import { expireUnpaid, OPEN_STATUSES, REOPENABLE_STATUSES, renewalDayValue } from "@/lib/membership";
import { reviewEligibility, markRefunded, unlockAccount } from "../actions";
import { updateProfile, setUserRole, deleteUser, membershipAction, grantMembership, addCpe, updateCpe } from "./actions";
import { ProfileFields, TierOptions } from "../_fields";
import { TempPassword } from "./TempPassword";
export const dynamic = "force-dynamic";

const badgeFor = (s: string) => s === "active" ? "badge-green" : s === "pending_verification" ? "badge-amber" : s === "rejected_verification" ? "badge-red" : "";
const cpeBadge = (s: string) => s === "approved" ? "badge-green" : s === "audit" ? "badge-red" : "badge-amber";

/** Admin → Members → one account: profile, role & access, memberships, CPE ledger, recent activity, deletion. */
export default async function AdminMember({ params, searchParams }: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const id = idParam((await params).id); // control characters / over-long → "" → not found
  const me = await requireAdmin(locale); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers");
  const { msg } = await searchParams;
  if (!id) notFound();
  await expireUnpaid(id); // BUG-042 lazy expiry, as on the list
  const u = await db.user.findUnique({ where: { id }, include: { memberships: { orderBy: { createdAt: "desc" } }, cpe: { orderBy: { createdAt: "desc" }, include: { event: { select: { title: true } } } } } });
  if (!u) notFound();
  const deleted = u.role === "deleted";
  const lock = deleted ? null : await db.loginThrottle.findUnique({ where: { key: `e:${u.email}` } });
  const locked = !!lock?.lockedUntil && +lock.lockedUntil > Date.now();
  const adminCount = await db.user.count({ where: { role: "admin" } });
  const ids = [u.id, ...u.memberships.map((m) => m.id)];
  const logs = await db.auditLog.findMany({ where: { OR: [{ target: { in: [...ids, `${u.id} (role: admin)`] } }, { actor: u.id }, { target: `user:${u.id}` }] }, orderBy: { createdAt: "desc" }, take: 12 });
  const staffIds = [...new Set([...logs.map((l) => l.actor), ...u.cpe.map((c) => c.createdBy ?? ""), ...u.memberships.map((m) => m.verifiedBy ?? "")].filter(Boolean))];
  const staff = new Map((await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, role: true } })).map((s) => [s.id, s.role === "deleted" ? "—" : s.name]));

  const dl = dateLocale(locale); const et = locale === "fr" ? "HE" : "ET";
  const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone }) : "—");
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${et}`;
  const tx = (k: string) => (t.has(k) ? t(k) : k.replace(/^\w+_/, ""));
  const logLabel = (a: string) => { const k = `log.${a.replace(/\./g, "_")}`; return t.has(k) ? t(k) : a.replace(/^[a-z]+\./, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase()); };
  const getTier = await tierLookup(); const tierName = (tid: string) => getTier(tid)?.name[locale] ?? tid; // admin-editable names (Admin → Settings)
  const tiers = (await allTiers()).map((x) => ({ id: x.id, name: x.name[locale] ?? x.name.en }));
  const notice = msg && /^(msg|err)_\w+$/.test(msg) && tm.has(msg) ? { cls: msg.startsWith("err_") ? "alert-danger" : "alert-success", text: tm(msg) } : null;
  const hasOpen = u.memberships.some((m) => (OPEN_STATUSES as readonly string[]).includes(m.status));
  const cpeApproved = u.cpe.filter((c) => c.status === "approved").reduce((a, c) => a + c.hours, 0);
  const minDay = renewalDayValue(new Date(Date.now() + 864e5));
  const hid = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="uid" value={u.id} /></>;
  const mh = (mid: string) => <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={mid} /></>;
  const back = (mid: string) => <>{mh(mid)}<input type="hidden" name="ret" value="detail" /></>; // existing list actions, returning here
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  const L = (p: string) => `/${locale}${p}`;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" className="app-main adm-mbr">
        <a className="small adm-mbr-back" href={L("/admin/members")}>← {t("membersTitle")}</a>
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{deleted ? tm("deletedName") : u.name}</h1>
          <div className="adm-actions adm-mbr-sub">{!deleted && <span className="small">{u.email}</span>}<span className="badge">{tx(`role_${u.role}`)}</span>{locked && <span className="badge badge-red">{t("locked")}</span>}{u.id === me.id && <span className="badge">{t("you")}</span>}</div></div>
          {!deleted && <a className="btn btn-secondary btn-sm" href={L(`/admin/audit?target=${encodeURIComponent(u.id)}`)}>{tm("fullLog")}</a>}
        </div>
        {notice && <div className={`alert ${notice.cls}`} role={notice.cls === "alert-danger" ? "alert" : "status"} style={{ marginBottom: 16 }}><div>{notice.text}</div></div>}
        {deleted && <div className="alert alert-info" role="status" style={{ marginBottom: 16 }}><div><b>{tm("deletedTitle")}</b>{tm("deletedBody", { date: day(u.deletedAt) })}</div></div>}

        {!deleted && <div className="grid g2 adm-dash-grid adm-section">
          <form action={updateProfile} className="card adm-form" id="profile" aria-labelledby="h-profile">
            {hid}
            <h2 id="h-profile" style={h2}>{tm("profileTitle")}</h2>
            <ProfileFields t={(k) => tm(k)} locale={locale} idp="p" d={u} />
            <div className="adm-form-foot"><span className="small muted">{tm("joinedOn", { date: day(u.createdAt) })}</span><button className="btn btn-accent btn-sm">{tm("saveProfile")}</button></div>
          </form>

          <section className="card" id="account" aria-labelledby="h-account">
            <h2 id="h-account" style={h2}>{tm("accountTitle")}</h2>
            <div className="adm-mbr-block">
              <h3 className="adm-mbr-h3">{t("role")}</h3>
              {u.id === me.id ? <p className="small muted" style={{ margin: 0 }}>{tm("selfRole")}</p> : (
                <form action={setUserRole} className="adm-mbr-inline">{hid}
                  <label htmlFor="role" className="sr-only">{t("role")}</label>
                  <select id="role" name="role" defaultValue={u.role}>{(["guest", "member", "admin"] as const).map((r) => <option key={r} value={r}>{tx(`role_${r}`)}</option>)}</select>
                  <button className="btn btn-secondary btn-sm">{tm("changeRole")}</button>
                </form>)}
              <p className="small muted" style={{ margin: 0 }}>{u.role === "admin" && adminCount <= 1 ? tm("lastAdminNote") : tm("roleHint")}</p>
            </div>
            <div className="adm-mbr-block">
              <h3 className="adm-mbr-h3">{tm("signInTitle")}</h3>
              {locked ? <div className="adm-actions"><span className="badge badge-red">{t("locked")}</span><span className="small">{tm("lockedUntil", { time: stamp(lock!.lockedUntil!) })}</span>
                <form action={unlockAccount}>{back(u.id)}<button className="btn btn-secondary btn-sm">{t("unlock")}</button></form></div>
                : <p className="small" style={{ margin: 0 }}>{lock?.failures ? tm("notLockedFailures", { n: lock.failures }) : tm("notLocked")}</p>}
            </div>
            <div className="adm-mbr-block"><TempPassword locale={locale} uid={u.id} /></div>
          </section>
        </div>}

        <section className="card adm-section" id="memberships" aria-labelledby="h-ms">
          <div className="adm-card-head"><h2 id="h-ms" style={h2}>{tm("membershipsTitle")}</h2><span className="small muted">{tm("membershipsHint")}</span></div>
          {u.memberships.length === 0 ? <div className="adm-empty"><p>{t("noMembership")}</p></div> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={tm("membershipsTitle")}><table className="adm-table adm-stack adm-mbr-table"><caption className="sr-only">{tm("membershipsTitle")}</caption>
              <thead><tr><th scope="col">{t("tier")}</th><th scope="col">{t("status")}</th><th scope="col">{tm("dates")}</th><th scope="col">{t("action")}</th></tr></thead><tbody>
              {u.memberships.map((m) => { const open = (OPEN_STATUSES as readonly string[]).includes(m.status); const reopen = (REOPENABLE_STATUSES as readonly string[]).includes(m.status); return (
                <tr key={m.id} className={m.status === "pending_verification" ? "is-pending" : undefined}>
                  <td data-label={t("tier")}><div className="adm-person"><b>{tierName(m.tierId)}</b>{m.eligibilityNote && <span className="small muted">{m.eligibilityNote}</span>}{m.paymentRef && <span className="small muted">{tm("paid")}</span>}</div></td>
                  <td data-label={t("status")}><div className="adm-person"><span><span className={`badge ${badgeFor(m.status)}`}>{tx(`status_${m.status}`)}</span></span>
                    {m.refundStatus === "refund_due" && <span><span className="badge badge-amber">{t("refundDue")}</span></span>}{m.refundStatus === "refunded" && <span><span className="badge badge-green">{t("refunded")}</span></span>}
                    {m.rejectionReason && <span className="small muted">{m.rejectionReason}</span>}</div></td>
                  <td data-label={tm("dates")}><dl className="adm-mbr-dl small">
                    <div><dt>{t("applied")}</dt><dd>{day(m.createdAt)}</dd></div>
                    {m.startsAt && <div><dt>{tm("starts")}</dt><dd>{day(m.startsAt)}</dd></div>}
                    {m.renewsAt && <div><dt>{tm("renews")}</dt><dd>{day(m.renewsAt)}</dd></div>}
                    {m.verifiedBy && <div><dt>{tm("decidedBy")}</dt><dd>{staff.get(m.verifiedBy) ?? m.verifiedBy}</dd></div>}
                  </dl></td>
                  <td data-label={t("action")}>{deleted ? <span className="muted">—</span> : <div className="adm-actions">
                    {m.status === "pending_verification" && <>
                      <form action={reviewEligibility}>{back(m.id)}<input type="hidden" name="decision" value="approve" /><button className="btn btn-accent btn-sm">{t("approve")}</button></form>
                      <details className="adm-reject"><summary className="btn btn-secondary btn-sm">{t("reject")}…</summary>
                        <form action={reviewEligibility}>{back(m.id)}<input type="hidden" name="decision" value="reject" /><label className="small" htmlFor={`rr-${m.id}`}>{t("reasonLabel")}</label><input id={`rr-${m.id}`} name="reason" type="text" placeholder={t("reasonPh")} maxLength={300} /><button className="btn btn-danger btn-sm">{t("confirmReject")}</button></form>
                      </details></>}
                    {m.status === "active" && <details className="adm-confirm"><summary className="btn btn-secondary btn-sm">{tm("renewal")}…</summary>
                      <form action={membershipAction}>{mh(m.id)}<input type="hidden" name="op" value="renewal" /><label className="small" htmlFor={`rn-${m.id}`}>{tm("renewsOn")} <span className="hint">({et})</span></label><input id={`rn-${m.id}`} name="renewsOn" type="date" required min={minDay} defaultValue={m.renewsAt ? renewalDayValue(m.renewsAt) : undefined} /><button className="btn btn-accent btn-sm">{tm("saveRenewal")}</button></form>
                    </details>}
                    {open && <details className="adm-confirm"><summary className="btn btn-secondary btn-sm">{tm("changeTier")}…</summary>
                      <form action={membershipAction}>{mh(m.id)}<input type="hidden" name="op" value="tier" /><label className="small" htmlFor={`ti-${m.id}`}>{t("tier")}</label><select id={`ti-${m.id}`} name="tier" defaultValue={m.tierId}><TierOptions list={tiers} /></select><button className="btn btn-accent btn-sm">{tm("saveTier")}</button></form>
                    </details>}
                    {m.status === "active" && <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm">{tm("markLapsed")}…</summary>
                      <form action={membershipAction}>{mh(m.id)}<input type="hidden" name="op" value="lapse" /><p className="small" style={{ margin: 0 }}>{tm("lapseConfirm")}</p><label className="check small"><input type="checkbox" name="confirm" required /> <span>{tm("confirmBox")}</span></label><button className="btn btn-danger btn-sm">{tm("markLapsedYes")}</button></form>
                    </details>}
                    {open && <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm">{tm("cancelMembership")}…</summary>
                      <form action={membershipAction}>{mh(m.id)}<input type="hidden" name="op" value="cancel" /><p className="small" style={{ margin: 0 }}>{tm("cancelConfirm")}</p><label className="check small"><input type="checkbox" name="confirm" required /> <span>{tm("confirmBox")}</span></label><button className="btn btn-danger btn-sm">{tm("cancelYes")}</button></form>
                    </details>}
                    {reopen && (hasOpen ? <span className="small muted">{tm("reopenBlocked")}</span> : <details className="adm-confirm"><summary className="btn btn-secondary btn-sm">{tm("reactivate")}…</summary>
                      <form action={membershipAction}>{mh(m.id)}<input type="hidden" name="op" value="reactivate" /><label className="small" htmlFor={`ra-${m.id}`}>{tm("renewsOn")} <span className="hint">({tm("defaultOneYear")})</span></label><input id={`ra-${m.id}`} name="renewsOn" type="date" min={minDay} /><button className="btn btn-accent btn-sm">{tm("reactivateYes")}</button></form>
                    </details>)}
                    {m.refundStatus === "refund_due" && <form action={markRefunded}>{back(m.id)}<button className="btn btn-secondary btn-sm">{t("markRefunded")}</button></form>}
                    {!open && !reopen && m.refundStatus !== "refund_due" && <span className="muted">—</span>}
                  </div>}</td>
                </tr>
              ); })}
            </tbody></table></div>)}
          {!deleted && !hasOpen && <form action={grantMembership} className="adm-mbr-grant">{hid}
            <h3 className="adm-mbr-h3">{tm("grantTitle")}</h3>
            <p className="small muted" style={{ margin: 0 }}>{tm("grantHint")}</p>
            <div className="adm-mbr-inline">
              <div className="field"><label htmlFor="g-tier">{t("tier")}</label><select id="g-tier" name="tier" required defaultValue=""><option value="" disabled>{tm("chooseTier")}</option><TierOptions list={tiers} /></select></div>
              <div className="field"><label htmlFor="g-renew">{tm("renewsOn")} <span className="hint">({tm("defaultOneYear")})</span></label><input id="g-renew" name="renewsOn" type="date" min={minDay} /></div>
              <button className="btn btn-accent btn-sm">{tm("grantButton")}</button>
            </div>
          </form>}
        </section>

        {!deleted && <section className="card adm-section" id="cpe" aria-labelledby="h-cpe">
          <div className="adm-card-head"><h2 id="h-cpe" style={h2}>{tm("cpeTitle")}</h2><span className="small muted">{tm("cpeTotal", { n: Math.round(cpeApproved * 100) / 100, target: cpeCycleTarget })}</span></div>
          {u.cpe.length === 0 ? <div className="adm-empty"><p>{tm("cpeNone")}</p></div> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={tm("cpeTitle")}><table className="adm-table adm-stack adm-mbr-cpe"><caption className="sr-only">{tm("cpeTitle")}</caption>
              <thead><tr><th scope="col">{tm("cpeEntry")}</th><th scope="col" className="num">{tm("cpeHours")}</th><th scope="col">{tm("cpeAdded")}</th><th scope="col">{t("status")}</th><th scope="col">{t("action")}</th></tr></thead><tbody>
              {u.cpe.map((c) => (
                <tr key={c.id}>
                  <td data-label={tm("cpeEntry")}><div className="adm-person"><b>{c.title}</b>{c.eventId && <span className="small muted">{tm("cpeFromEvent")}</span>}{c.createdBy && <span className="small muted">{tm("cpeBy", { name: staff.get(c.createdBy) ?? c.createdBy })}</span>}</div></td>
                  <td className="num" data-label={tm("cpeHours")}>{c.hours}</td>
                  <td className="nowrap" data-label={tm("cpeAdded")}>{day(c.createdAt)}</td>
                  <td data-label={t("status")}><form action={updateCpe} className="adm-mbr-inline">{mh(c.id)}<span className={`badge ${cpeBadge(c.status)}`}>{tm(`cpe_${c.status}` as "cpe_approved")}</span>
                    <label htmlFor={`cs-${c.id}`} className="sr-only">{t("status")}</label><select id={`cs-${c.id}`} name="status" defaultValue={c.status}>{["submitted", "approved", "audit"].map((s) => <option key={s} value={s}>{tm(`cpe_${s}` as "cpe_approved")}</option>)}</select>
                    <button className="btn btn-secondary btn-sm">{tm("cpeUpdate")}</button></form></td>
                  <td data-label={t("action")}><details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm" aria-label={`${tm("cpeRemove")}: ${c.title}`}>{tm("cpeRemove")}…</summary>
                    <form action={updateCpe}>{mh(c.id)}<input type="hidden" name="op" value="remove" /><p className="small" style={{ margin: 0 }}>{tm("cpeRemoveConfirm")}</p><button className="btn btn-danger btn-sm">{tm("cpeRemoveYes")}</button></form>
                  </details></td>
                </tr>
              ))}
            </tbody></table></div>)}
          <form action={addCpe} className="adm-mbr-grant">{hid}
            <h3 className="adm-mbr-h3">{tm("cpeAddTitle")}</h3>
            <div className="adm-mbr-inline">
              <div className="field adm-mbr-grow"><label htmlFor="c-title">{tm("cpeEntry")}</label><input id="c-title" name="title" type="text" required maxLength={200} /></div>
              <div className="field"><label htmlFor="c-hours">{tm("cpeHours")}</label><input id="c-hours" name="hours" type="number" required min={0.25} max={100} step={0.25} defaultValue={1} /></div>
              <div className="field"><label htmlFor="c-status">{t("status")}</label><select id="c-status" name="status" defaultValue="approved">{["submitted", "approved", "audit"].map((s) => <option key={s} value={s}>{tm(`cpe_${s}` as "cpe_approved")}</option>)}</select></div>
              <button className="btn btn-accent btn-sm">{tm("cpeAdd")}</button>
            </div>
          </form>
        </section>}

        <section className="card adm-section" aria-labelledby="h-act">
          <div className="adm-card-head"><h2 id="h-act" style={h2}>{tm("activityTitle")}</h2>{!deleted && <a className="small" href={L(`/admin/audit?target=${encodeURIComponent(u.id)}`)}>{tm("fullLog")} →</a>}</div>
          {logs.length ? <ul className="adm-log">{logs.map((l) => <li key={l.id}><span>{logLabel(l.action)}<span className="small muted"> · {l.actor === u.id ? tm("byThem") : staff.get(l.actor) ?? l.actor}</span></span><time className="small muted" dateTime={l.createdAt.toISOString()}>{stamp(l.createdAt)}</time></li>)}</ul>
            : <div className="adm-empty"><p>{t("noActivity")}</p></div>}
        </section>

        {!deleted && <form action={deleteUser} className="card adm-section adm-mbr-danger" id="delete" aria-labelledby="h-del">{hid}
          <h2 id="h-del" style={h2}>{tm("deleteTitle")}</h2>
          <p style={{ margin: 0 }}>{tm("deleteBody")}</p>
          {u.id === me.id ? <p className="small muted" style={{ margin: 0 }}>{tm("deleteSelf")}</p> : u.role === "admin" && adminCount <= 1 ? <p className="small muted" style={{ margin: 0 }}>{tm("lastAdminNote")}</p> : <>
            <label className="check"><input type="checkbox" name="confirm" required /> <span>{tm("deleteConfirm", { name: u.name })}</span></label>
            <div><button className="btn btn-danger btn-sm">{tm("deleteButton")}</button></div></>}
        </form>}
      </main>
    </div>
  );
}
