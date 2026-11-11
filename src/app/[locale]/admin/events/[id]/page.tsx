import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { fmt2, evLabel, type Currency, type Locale } from "@/config/site";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { eventView, isUnconfirmed, eventTypeBadgeClass, eventTimeZone, dateLocale, fmtCpe, eventLocation, stripStatus } from "@/components/EventCard";
import { EventFields } from "../EventFields";
import { Icon } from "@/components/ui/Icon";
import { AdminHead, AdminTabs, AdminSearch, AdminEmpty, AdminReadOnly, AdminDl, type TabItem } from "../../_components/AdminUI";
import { updateEvent, deleteEvent, cancelEvent, restoreEvent, setAttendance, cancelRegistration } from "../actions";
import { REG_VIEWS, regView, regViewWhere, regSearchWhere, cleanQuery, type RegView } from "../views";
import { SelectAll } from "./SelectAll";
import { EventFormHelper } from "../EventFormHelper";
export const dynamic = "force-dynamic";

const OK = new Set(["saved", "deleted", "cancelled", "restored", "attendanceMarked", "attendanceUnmarked", "regCancelled"]);
const INFO = new Set(["attendancePartial", "attendanceNone", "alreadyCancelled", "notCancelled", "noneSelected"]);
/** Refusals of the Event details form (updateEvent): the typed values are restored after any of them (FIXLIST D9 / FA2-2). */
const EDIT_REFUSALS = new Set(["invalid", "slugInvalid", "slugTaken", "slugLocked", "cancelledLocked", "conflict"]);
const ERR = new Set(["invalid", "slugInvalid", "slugTaken", "slugLocked", "cancelledLocked", "conflict", "hasRegistrations", "cancelledNoAttendance", "notStartedNoAttendance", "regNotCancellable"]);
const statusTone = (s: string) => (s === "confirmed" ? "status-available" : s === "pending_payment" ? "status-pending" : s === "cancelled" ? "status-danger" : "status-neutral");

/** Admin → Events → one event: KPIs, registrations (filters, CSV, attendance + CPE, cancel), edit form, cancel/restore/delete. */
export default async function AdminEvent({ params, searchParams }: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ msg?: string; v?: string; q?: string }> }) {
  const { locale, id } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "events", "view"); const me = ctx.user;
  // The page is readable with events.view; every control below is shown only with the permission its action checks (§3.2).
  const canEdit = can(ctx, "events", "edit"), canDelete = can(ctx, "events", "delete");
  const canUsers = can(ctx, "users", "view"), canMembers = can(ctx, "members", "view");
  const t = await getTranslations("adminEvents"); const tp = await getTranslations("profile"); const ta = await getTranslations("admin"); const tev = await getTranslations("events");
  const sp = await searchParams;
  const e = idParam(id) ? await db.event.findUnique({ where: { id } }) : null;
  if (!e) notFound();
  const view: RegView = regView(sp.v); const q = cleanQuery(sp.q);
  const [regs, groups, attendedN, memberN, paid, credited] = await Promise.all([
    db.registration.findMany({ where: { eventId: e.id, ...regViewWhere(view), ...regSearchWhere(q) }, include: { user: { select: { id: true, name: true, email: true, role: true } } }, orderBy: { createdAt: "asc" } }),
    db.registration.groupBy({ by: ["status"], where: { eventId: e.id, ...regSearchWhere(q) }, _count: { _all: true } }),
    db.registration.groupBy({ by: ["attended"], where: { eventId: e.id, status: "confirmed", ...regSearchWhere(q) }, _count: { _all: true } }),
    db.registration.count({ where: { eventId: e.id, status: "confirmed", ticket: "member" } }),
    db.registration.groupBy({ by: ["currency"], where: { eventId: e.id, status: "confirmed", amountCents: { gt: 0 } }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.cpeEntry.findMany({ where: { eventId: e.id }, select: { userId: true, hours: true } }),
  ]);
  const byStatus = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const att = (a: boolean) => attendedN.find((g) => g.attended === a)?._count._all ?? 0;
  const counts: Record<RegView, number> = { all: groups.reduce((n, g) => n + g._count._all, 0), confirmed: byStatus("confirmed"), attended: att(true), absent: att(false), pending: byStatus("pending_payment"), cancelled: byStatus("cancelled") };
  // KPIs are for the whole event (not the search); recount without the search when one is active.
  const totals = q ? await Promise.all([
    db.registration.count({ where: { eventId: e.id, status: "confirmed" } }), db.registration.count({ where: { eventId: e.id, status: "confirmed", attended: true } }),
    db.registration.count({ where: { eventId: e.id, status: "pending_payment" } }), db.registration.count({ where: { eventId: e.id } }),
  ]) : [counts.confirmed, counts.attended, counts.pending, counts.all];
  const [confirmedN, attendedTotal, pendingN, anyRegs] = totals;
  const creditBy = new Map(credited.map((c) => [c.userId, c.hours]));

  const v = eventView(e, locale);
  const dl = dateLocale(locale);
  const stamp = (d: Date) => `${d.toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${ta("et")}`;
  const L = (p: string) => `/${locale}${p}`;
  const base = L(`/admin/events/${e.id}`);
  const href = (k: RegView) => { const p = new URLSearchParams(); if (k !== "all") p.set("v", k); if (q) p.set("q", q); const s = p.toString(); return `${base}${s ? `?${s}` : ""}#registrations`; };
  const csvHref = (() => { const p = new URLSearchParams(); if (view !== "all") p.set("v", view); if (q) p.set("q", q); const s = p.toString(); return `/api/admin/events/${e.id}/registrations.csv${s ? `?${s}` : ""}`; })();
  const hid = <><input type="hidden" name="id" value={e.id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="v" value={view} /><input type="hidden" name="q" value={q} /></>;
  const msg = sp.msg ?? "";
  const alertCls = OK.has(msg) ? "alert-success" : INFO.has(msg) ? "alert-info" : ERR.has(msg) ? "alert-danger" : null;
  const revenue = paid.map((p) => fmt2(p._sum.amountCents ?? 0, p.currency as Currency, locale)).join(" · ");
  const paidTickets = paid.reduce((n, p) => n + p._count._all, 0);
  const canCancelReg = (r: (typeof regs)[number]) => r.status === "pending_payment" || (r.status === "confirmed" && r.amountCents === 0);
  const BULK = "bulk-att";
  // Attendance can be recorded only once the event has started (server action refuses earlier); undo is always possible.
  const started = +e.startsAt <= Date.now();
  const canMark = started && !e.cancelledAt;
  const where = eventLocation(e, tev("venueTbc"));
  /** Registrant link (§5.5): admins → Users, members/guests → Members, each only with that module's view; else plain text. */
  const personHref = (u: { id: string; role: string }) => u.role === "deleted" ? null
    : u.role === "admin" ? (canUsers ? L(`/admin/users/${u.id}`) : null) : (canMembers ? L(`/admin/members/${u.id}`) : null);

  const tabs: TabItem[] = REG_VIEWS.map((k) => ({ key: k, href: href(k), label: t(`v_${k}`), count: counts[k], current: view === k }));
  const sep = <span className="adm-sep" aria-hidden="true">·</span>;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/events" />
      <main id="main" tabIndex={-1} className="app-main adm-ev">
        <AdminHead back={{ href: L("/admin/events"), label: t("back") }} title={v.title}
          meta={<>
            <span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span>
            {e.cancelledAt ? <span className="status status-danger">{t("cancelledBadge")}</span> : e.published ? <span className="status status-available">{ta("publishedBadge")}</span> : <span className="status status-dev">{ta("draftBadge")}</span>}
            {isUnconfirmed(e) && <span className="status status-dev" title={ta("proposedHint")}>{ta("proposedBadge")}</span>}
            {v.past && <span className="status status-neutral">{ta("past")}</span>}
            <span>{stamp(e.startsAt)}</span>{sep}<span>{evLabel(e.format, locale)}{where ? ` · ${where}` : ""}</span>
          </>}
          actions={<a className="btn btn-secondary btn-sm" href={L(`/events/${e.slug}`)}>{t("viewPublic")}<Icon name="arrow-up-right" size={16} /></a>} />
        {alertCls && <FocusOnLoad><div className={`alert ${alertCls} adm-notice`} id="adm-ev-notice" role={alertCls === "alert-danger" ? "alert" : "status"}><div>{t(`msg_${msg}`)}</div></div></FocusOnLoad>}
        {e.cancelledAt && <div className="alert alert-warning adm-notice" role="note"><div><b>{t("cancelledTitle")}</b>{t("cancelledNotice", { date: stamp(e.cancelledAt) })}{paidTickets > 0 ? ` ${t("cancelledPaid", { n: paidTickets })}` : ""}</div></div>}

        {!canEdit && !canDelete && <AdminReadOnly text={ta("readOnly")} />}

        <div className="kpis">
          <div className="kpi"><div className="k">{t("kpiConfirmed")}</div><div className="v">{confirmedN}</div><div className="d">{t("kpiConfirmedD", { n: memberN })}</div></div>
          <div className="kpi is-blue"><div className="k">{t("kpiAttended")}</div><div className="v">{attendedTotal}</div><div className="d">{t("kpiAttendedD", { cpe: fmtCpe(e.cpe, locale) })}</div></div>
          <div className={`kpi${pendingN ? " kpi-attn" : " is-navy"}`}><div className="k">{t("kpiPending")}</div><div className="v">{pendingN}</div><div className="d">{t("kpiPendingD")}</div></div>
          <div className="kpi is-navy"><div className="k">{t("kpiRevenue")}</div><div className="v">{revenue || fmt2(0, "USD", locale)}</div><div className="d">{t("kpiRevenueD", { n: paidTickets })}</div></div>
        </div>

        {/* Without events.edit there is no edit form: the event's own details, read-only (VIS m5). */}
        {!canEdit && <section className="adm-sheet adm-ev-ro" id="ev-details" aria-labelledby="h-ev-details">
          <div className="settings-section">
            <header><h2 id="h-ev-details">{t("editTitle")}</h2><p>{t("detailsRoHint")}</p></header>
            <div className="adm-fields"><AdminDl notSet={ta("notSet")} items={[
              { key: "title", label: ta("titleEn"), value: stripStatus(e.title).trim(), wide: true },
              { key: "summary", label: ta("summary"), value: e.summary ? <span className="adm-ro-pre">{e.summary}</span> : null, wide: true },
              { key: "type", label: ta("type"), value: evLabel(e.type, locale) },
              { key: "format", label: ta("format"), value: evLabel(e.format, locale) },
              { key: "starts", label: ta("startsAt"), value: stamp(e.startsAt) },
              { key: "duration", label: ta("duration"), value: e.durationMin },
              { key: "location", label: ta("location"), value: e.location },
              { key: "cpe", label: ta("cpeHours"), value: fmtCpe(e.cpe, locale) },
              { key: "member", label: ta("memberPrice"), value: e.memberPriceCents === 0 ? t("free") : fmt2(e.memberPriceCents, "USD", locale) },
              { key: "public", label: ta("publicPrice"), value: e.publicPriceCents === null ? null : e.publicPriceCents === 0 ? t("free") : fmt2(e.publicPriceCents, "USD", locale) },
              { key: "access", label: t("secAccess"), value: e.accessInfo ? <span className="adm-ro-pre">{e.accessInfo}</span> : null, wide: true },
              { key: "slug", label: t("slug"), value: <code>/events/{e.slug}</code>, wide: true },
            ]} /></div>
          </div>
        </section>}

        <section className="panel adm-section adm-regs" id="registrations" aria-labelledby="h-regs">
          <div className="panel-head"><h2 id="h-regs">{t("regsTitle")}</h2><a className="btn btn-secondary btn-sm" href={csvHref}><Icon name="download" size={16} />{t("exportCsv")}</a></div>
          <AdminTabs label={t("filterLabel")} items={tabs} />
          <div className="table-toolbar">
            <AdminSearch id="rq" action={`${base}#registrations`} value={q} label={t("search")} placeholder={t("searchPh")} hidden={{ v: view !== "all" ? view : undefined }} button={t("search")} />
          </div>
          {regs.length === 0 ? (
            anyRegs === 0 ? <AdminEmpty level={3} title={t("noRegs")} /> : <AdminEmpty level={3} title={t("noRegsFilter")} action={<a className="btn btn-secondary btn-sm" href={`${base}#registrations`}>{t("v_all")}</a>} />
          ) : (<>
            {/* Before the start the reason is said once, here; the toolbar hint below keeps explaining CPE credit. */}
            {canEdit && !started && !e.cancelledAt && <div className="alert alert-info adm-ev-notyet" role="note" id="att-off"><div>{t("notStartedHint", { date: stamp(e.startsAt) })}</div></div>}
            {canEdit && <form id={BULK} action={setAttendance} className="adm-ev-bulk">
              {hid}
              <SelectAll formId={BULK} label={t("selectAll")} />
              <div className="adm-actions">
                <button className="btn btn-accent btn-sm" name="to" value="1" disabled={!canMark} aria-describedby={!started && !e.cancelledAt ? "att-off" : undefined}>{t("bulkAttended")}</button>
                {/* Undo only: off while nobody is marked attended (same disabled look as the button above). */}
                <button className="btn btn-secondary btn-sm" name="to" value="0" disabled={attendedTotal === 0} aria-describedby={attendedTotal === 0 ? "att-none" : undefined}>{t("bulkNotAttended")}</button>
              </div>
              <p className="small muted adm-ev-hint">{t("bulkHint")}{attendedTotal === 0 && <span id="att-none"> {t("noneAttendedYet")}</span>}</p>
            </form>}
            <div className="table-wrap" tabIndex={0} role="region" aria-label={ta("scrollRegion", { name: t("regsTitle") })}><table className="adm-table adm-stack adm-table-regs adm-stack-md"><caption className="sr-only">{t("regsTitle")}</caption>
              <thead><tr><th scope="col">{t("colPerson")}</th><th scope="col">{t("colTicket")}</th><th scope="col">{t("colStatus")}</th><th scope="col" className="num">{t("colAmount")}</th><th scope="col">{t("colRegistered")}</th><th scope="col">{t("colAttended")}</th>{canEdit && <th scope="col" className="adm-col-actions">{t("colActions")}</th>}</tr></thead>
              <tbody>{regs.map((r) => { const credit = creditBy.get(r.userId); const deleted = r.user.role === "deleted"; return (
                <tr key={r.id}>
                  <td data-label={t("colPerson")} className="adm-cell-person"><div className="adm-ev-person">
                    {!canEdit ? null : r.status === "confirmed" ? <label className="adm-hit"><input type="checkbox" name="ids" value={r.id} form={BULK} aria-label={t("selectRow", { name: r.user.name })} /></label> : <span className="adm-ev-nocheck" aria-hidden="true" />}
                    <div className="adm-person">{personHref(r.user) ? <a href={personHref(r.user)!}>{r.user.name}</a> : <b>{r.user.name}</b>}{deleted ? <span><span className="badge">{t("deletedAccount")}</span></span> : <span className="small">{r.user.email}</span>}</div>
                  </div></td>
                  <td data-label={t("colTicket")}>{r.ticket === "member" ? tev("member") : tev("nonMember")}</td>
                  <td data-label={t("colStatus")}><span className={`status ${statusTone(r.status)}`}>{t.has(`status_${r.status}`) ? t(`status_${r.status}`) : r.status}</span></td>
                  <td className="num" data-label={t("colAmount")}>{r.amountCents === 0 ? t("free") : fmt2(r.amountCents, r.currency as Currency, locale)}</td>
                  <td className="nowrap" data-label={t("colRegistered")}>{stamp(r.createdAt)}</td>
                  <td data-label={t("colAttended")}>{r.attended ? <div className="adm-person"><span><span className="status status-available">{t("attended")}</span></span>{credit !== undefined && <span className="small muted">{t("cpeCredited", { cpe: fmtCpe(credit, locale) })}</span>}</div> : <span className="small muted">{r.status === "confirmed" ? t("notRecorded") : "—"}</span>}</td>
                  {canEdit && <td className="adm-col-actions"><div className="adm-actions">
                    {r.status === "confirmed" && (r.attended
                      ? <form action={setAttendance}>{hid}<input type="hidden" name="r" value={r.id} /><input type="hidden" name="to" value="0" /><button className="btn btn-ghost btn-sm" aria-label={`${t("unmark")}: ${r.user.name}`}>{t("unmark")}</button></form>
                      : canMark && <form action={setAttendance}>{hid}<input type="hidden" name="r" value={r.id} /><input type="hidden" name="to" value="1" /><button className="btn btn-accent btn-sm" aria-label={`${t("markAttended")}: ${r.user.name}`}>{t("markAttended")}</button></form>)}
                    {canCancelReg(r) ? (
                      <details className="confirm adm-confirm"><summary className="btn btn-danger-outline btn-sm" aria-label={`${t("cancelReg")}: ${r.user.name}`}>{t("cancelRegShort")}…</summary>
                        <form action={cancelRegistration} className="confirm-box">{hid}<input type="hidden" name="r" value={r.id} /><p>{t("cancelRegConfirm", { name: r.user.name })}</p><div className="confirm-actions"><button className="btn btn-danger btn-sm">{t("cancelRegYes")}</button></div></form>
                      </details>
                    ) : r.status === "confirmed" && <span className="small muted">{t("paidNoCancel")}</span>}
                  </div></td>}
                </tr>
              ); })}</tbody>
            </table></div>
          </>)}
        </section>

        {canEdit && <form action={updateEvent} className="adm-sheet adm-edit" id="edit" aria-labelledby="h-edit">
          <header className="adm-sheet-head"><h2 id="h-edit">{t("editTitle")}</h2><p>{t("editHint")}</p></header>
          {hid}
          <EventFields locale={locale} e={e} idp="e-" />
          <EventFormHelper storageKey={`edit-${e.id}`} userId={me.id} restore={EDIT_REFUSALS.has(msg)} noticeId="adm-ev-notice" msgs={{ required: t("fieldRequired"), date: t("fieldDate"), range: String(t.raw("fieldRange")) }} />
          <div className="settings-section"><header><h3>{t("secAddress")}</h3></header>
            <div className="adm-fields"><div className="field adm-ev-slug"><label htmlFor="e-sl">{t("slug")}</label>
              <input type="text" id="e-sl" name="slug" defaultValue={e.slug} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={anyRegs > 0} aria-describedby="e-sl-h" />
              <span className="hint" id="e-sl-h">{anyRegs > 0 ? t("slugLockedHint") : t("slugHint")}</span></div></div>
          </div>
          <div className="savebar">
            {e.cancelledAt ? <span className="savebar-note">{t("cancelledNoPublish")}</span>
              : <label className="check"><input type="checkbox" name="published" defaultChecked={e.published} /> <span>{t("publishedLabel")}</span></label>}
            <button className="btn btn-accent">{t("save")}</button>
          </div>
        </form>}

        {(canEdit || canDelete) && <section className="panel danger-zone" id="danger" aria-labelledby="h-danger"><div className="settings-section">
          <header><p className="danger-zone-label"><Icon name="alert" size={16} />{tp("dangerLabel")}</p><h2 id="h-danger">{t(!canDelete ? (e.cancelledAt ? "dangerTitleRestore" : "dangerTitleCancel") : !canEdit ? "dangerTitleDelete" : "dangerTitle")}</h2></header>
          <div className="adm-fields">
          {!canEdit ? null : e.cancelledAt ? (
            <div className="danger-row"><div><b>{t("restoreBtn")}</b><p>{t("restoreBody")}</p></div>
              <form action={restoreEvent}>{hid}<button className="btn btn-secondary btn-sm">{t("restoreBtn")}</button></form></div>
          ) : (
            <div className="danger-row"><div><b>{t("cancelBtn")}</b><p>{t("cancelBody")}</p></div>
              <details className="confirm adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("cancelBtn")}…</summary>
                <form action={cancelEvent} className="confirm-box">{hid}<p>{t("cancelConfirm", { title: v.title })}</p><div className="confirm-actions"><button className="btn btn-danger btn-sm">{t("cancelYes")}</button></div></form>
              </details></div>
          )}
          {canDelete && <div className="danger-row"><div><b>{t("deleteBtn")}</b><p>{anyRegs === 0 ? t("deleteBody") : t("deleteBlocked")}</p></div>
            {anyRegs === 0 && <details className="confirm adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("deleteBtn")}…</summary>
              <form action={deleteEvent} className="confirm-box">{hid}<p>{t("deleteConfirm", { title: v.title })}</p><div className="confirm-actions"><button className="btn btn-danger btn-sm">{t("deleteYes")}</button></div></form>
            </details>}</div>}
          </div>
        </div></section>}
      </main>
    </div>
  );
}
