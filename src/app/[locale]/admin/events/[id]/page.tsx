import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { fmt2, evLabel, type Currency, type Locale } from "@/config/site";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { idParam } from "@/lib/validation";
import { AdminNav } from "@/components/AppShell";
import { eventView, isUnconfirmed, eventTypeBadgeClass, eventTimeZone, dateLocale, fmtCpe, eventLocation } from "@/components/EventCard";
import { EventFields, formLegend } from "../EventFields";
import { updateEvent, deleteEvent, cancelEvent, restoreEvent, setAttendance, cancelRegistration } from "../actions";
import { REG_VIEWS, regView, regViewWhere, regSearchWhere, cleanQuery, type RegView } from "../views";
import { SelectAll } from "./SelectAll";
export const dynamic = "force-dynamic";

const OK = new Set(["saved", "deleted", "cancelled", "restored", "attendanceMarked", "attendanceUnmarked", "regCancelled"]);
const INFO = new Set(["attendancePartial", "attendanceNone", "alreadyCancelled", "notCancelled", "noneSelected"]);
const ERR = new Set(["invalid", "slugInvalid", "slugTaken", "slugLocked", "cancelledLocked", "conflict", "hasRegistrations", "cancelledNoAttendance", "notStartedNoAttendance", "regNotCancellable"]);
const statusBadge = (s: string) => (s === "confirmed" ? "badge-green" : s === "pending_payment" ? "badge-amber" : "");

/** Admin → Events → one event: KPIs, registrations (filters, CSV, attendance + CPE, cancel), edit form, cancel/restore/delete. */
export default async function AdminEvent({ params, searchParams }: { params: Promise<{ locale: Locale; id: string }>; searchParams: Promise<{ msg?: string; v?: string; q?: string }> }) {
  const { locale, id } = await params; setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("adminEvents"); const ta = await getTranslations("admin"); const tev = await getTranslations("events");
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
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  const revenue = paid.map((p) => fmt2(p._sum.amountCents ?? 0, p.currency as Currency, locale)).join(" · ");
  const paidTickets = paid.reduce((n, p) => n + p._count._all, 0);
  const canCancelReg = (r: (typeof regs)[number]) => r.status === "pending_payment" || (r.status === "confirmed" && r.amountCents === 0);
  const BULK = "bulk-att";
  // Attendance can be recorded only once the event has started (server action refuses earlier); undo is always possible.
  const started = +e.startsAt <= Date.now();
  const canMark = started && !e.cancelledAt;
  const where = eventLocation(e, tev("venueTbc"));

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/events" />
      <main id="main" className="app-main adm-ev">
        <p className="small adm-ev-back"><a href={L("/admin/events")}>← {t("back")}</a></p>
        <div className="app-head">
          <div><span className="eyebrow">{ta("eyebrow")} · {ta("events")}</span><h1>{v.title}</h1>
            <div className="adm-actions adm-ev-tags">
              <span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span>
              {e.cancelledAt ? <span className="badge badge-red">{t("cancelledBadge")}</span> : e.published ? <span className="badge badge-green">{ta("publishedBadge")}</span> : <span className="badge">{ta("draftBadge")}</span>}
              {isUnconfirmed(e) && <span className="badge ev-status" title={ta("proposedHint")}>{ta("proposedBadge")}</span>}
              {v.past && <span className="badge">{ta("past")}</span>}
              <span className="small muted">{stamp(e.startsAt)} · {evLabel(e.format, locale)}{where ? ` · ${where}` : ""}</span>
            </div>
          </div>
          <a className="btn btn-secondary btn-sm" href={L(`/events/${e.slug}`)}>{t("viewPublic")}</a>
        </div>
        {alertCls && <div className={`alert ${alertCls}`} role={alertCls === "alert-danger" ? "alert" : "status"} style={{ marginBottom: 16 }}><div>{t(`msg_${msg}`)}</div></div>}
        {e.cancelledAt && <div className="alert alert-warning" role="note" style={{ marginBottom: 16 }}><div><b>{t("cancelledTitle")}</b>{t("cancelledNotice", { date: stamp(e.cancelledAt) })}{paidTickets > 0 ? ` ${t("cancelledPaid", { n: paidTickets })}` : ""}</div></div>}

        <div className="grid g4 adm-kpis">
          <div className="kpi"><div className="k">{t("kpiConfirmed")}</div><div className="v">{confirmedN}</div><div className="d">{t("kpiConfirmedD", { n: memberN })}</div></div>
          <div className="kpi"><div className="k">{t("kpiAttended")}</div><div className="v">{attendedTotal}</div><div className="d">{t("kpiAttendedD", { cpe: fmtCpe(e.cpe, locale) })}</div></div>
          <div className={`kpi${pendingN ? " kpi-attn" : ""}`}><div className="k">{t("kpiPending")}</div><div className="v">{pendingN}</div><div className="d">{t("kpiPendingD")}</div></div>
          <div className="kpi"><div className="k">{t("kpiRevenue")}</div><div className="v">{revenue || fmt2(0, "USD", locale)}</div><div className="d">{t("kpiRevenueD", { n: paidTickets })}</div></div>
        </div>

        <section className="card adm-section" id="registrations" aria-labelledby="h-regs">
          <div className="adm-card-head"><h2 id="h-regs" style={h2}>{t("regsTitle")}</h2><a className="btn btn-secondary btn-sm" href={csvHref}>{t("exportCsv")}</a></div>
          <div className="adm-toolbar">
            <nav className="adm-filters adm-ev-filters" aria-label={t("filterLabel")}>{REG_VIEWS.map((k) => <a key={k} href={href(k)} aria-current={view === k ? "page" : undefined}>{t(`v_${k}`)} <span className="adm-n">{counts[k]}</span></a>)}</nav>
            <form className="search-bar" role="search" action={`${base}#registrations`}>{view !== "all" && <input type="hidden" name="v" value={view} />}<label htmlFor="rq" className="sr-only">{t("search")}</label><input id="rq" name="q" type="search" defaultValue={q} placeholder={t("searchPh")} maxLength={200} /><button className="btn btn-secondary btn-sm">{t("search")}</button></form>
          </div>
          {regs.length === 0 ? (
            <div className="adm-empty"><p>{anyRegs === 0 ? t("noRegs") : t("noRegsFilter")}</p></div>
          ) : (<>
            {/* Before the start the reason is said once, here; the toolbar hint below keeps explaining CPE credit. */}
            {!started && !e.cancelledAt && <div className="alert alert-info adm-ev-notyet" role="note" id="att-off"><div>{t("notStartedHint", { date: stamp(e.startsAt) })}</div></div>}
            <form id={BULK} action={setAttendance} className="adm-ev-bulk">
              {hid}
              <SelectAll formId={BULK} label={t("selectAll")} />
              <div className="adm-actions">
                <button className="btn btn-accent btn-sm" name="to" value="1" disabled={!canMark} aria-describedby={!started && !e.cancelledAt ? "att-off" : undefined}>{t("bulkAttended")}</button>
                {/* Undo only: off while nobody is marked attended (same disabled look as the button above). */}
                <button className="btn btn-secondary btn-sm" name="to" value="0" disabled={attendedTotal === 0} aria-describedby={attendedTotal === 0 ? "att-none" : undefined}>{t("bulkNotAttended")}</button>
              </div>
              <p className="small muted adm-ev-hint">{t("bulkHint")}{attendedTotal === 0 && <span id="att-none"> {t("noneAttendedYet")}</span>}</p>
            </form>
            <div className="table-wrap" tabIndex={0} role="region" aria-label={ta("tableLabel")}><table className="adm-table adm-stack adm-table-regs"><caption className="sr-only">{t("regsTitle")}</caption>
              <thead><tr><th scope="col">{t("colPerson")}</th><th scope="col">{t("colTicket")}</th><th scope="col">{t("colStatus")}</th><th scope="col" className="num">{t("colAmount")}</th><th scope="col">{t("colRegistered")}</th><th scope="col">{t("colAttended")}</th><th scope="col">{t("colActions")}</th></tr></thead>
              <tbody>{regs.map((r) => { const credit = creditBy.get(r.userId); const deleted = r.user.role === "deleted"; return (
                <tr key={r.id}>
                  <td data-label={t("colPerson")}><div className="adm-ev-person">
                    {r.status === "confirmed" ? <input type="checkbox" name="ids" value={r.id} form={BULK} aria-label={t("selectRow", { name: r.user.name })} /> : <span className="adm-ev-nocheck" aria-hidden="true" />}
                    <div className="adm-person"><b>{r.user.name}</b>{deleted ? <span><span className="badge">{t("deletedAccount")}</span></span> : <span className="small">{r.user.email}</span>}</div>
                  </div></td>
                  <td data-label={t("colTicket")}>{r.ticket === "member" ? tev("member") : tev("nonMember")}</td>
                  <td data-label={t("colStatus")}><span className={`badge ${statusBadge(r.status)}`}>{t.has(`status_${r.status}`) ? t(`status_${r.status}`) : r.status}</span></td>
                  <td className="num" data-label={t("colAmount")}>{r.amountCents === 0 ? t("free") : fmt2(r.amountCents, r.currency as Currency, locale)}</td>
                  <td className="nowrap" data-label={t("colRegistered")}>{stamp(r.createdAt)}</td>
                  <td data-label={t("colAttended")}>{r.attended ? <div className="adm-person"><span><span className="badge badge-green">{t("attended")}</span></span>{credit !== undefined && <span className="small muted">{t("cpeCredited", { cpe: fmtCpe(credit, locale) })}</span>}</div> : <span className="small muted">{r.status === "confirmed" ? t("notRecorded") : "—"}</span>}</td>
                  <td><div className="adm-actions">
                    {r.status === "confirmed" && (r.attended
                      ? <form action={setAttendance}>{hid}<input type="hidden" name="r" value={r.id} /><input type="hidden" name="to" value="0" /><button className="btn btn-secondary btn-sm" aria-label={`${t("unmark")}: ${r.user.name}`}>{t("unmark")}</button></form>
                      : canMark && <form action={setAttendance}>{hid}<input type="hidden" name="r" value={r.id} /><input type="hidden" name="to" value="1" /><button className="btn btn-accent btn-sm" aria-label={`${t("markAttended")}: ${r.user.name}`}>{t("markAttended")}</button></form>)}
                    {canCancelReg(r) ? (
                      <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm" aria-label={`${t("cancelReg")}: ${r.user.name}`}>{t("cancelRegShort")}…</summary>
                        <form action={cancelRegistration}>{hid}<input type="hidden" name="r" value={r.id} /><p className="small" style={{ margin: 0 }}>{t("cancelRegConfirm", { name: r.user.name })}</p><button className="btn btn-danger btn-sm">{t("cancelRegYes")}</button></form>
                      </details>
                    ) : r.status === "confirmed" && <span className="small muted">{t("paidNoCancel")}</span>}
                  </div></td>
                </tr>
              ); })}</tbody>
            </table></div>
          </>)}
        </section>

        <form action={updateEvent} className="card adm-form adm-section" id="edit">
          <h2 style={h2}>{t("editTitle")}</h2>
          <p className="small muted" style={{ margin: "0 0 8px" }}>{t("editHint")}</p>
          {hid}
          <EventFields locale={locale} e={e} idp="e-" />
          <h3 style={formLegend}>{t("secAddress")}</h3>
          <div className="field adm-ev-slug"><label htmlFor="e-sl">{t("slug")}</label>
            <input type="text" id="e-sl" name="slug" defaultValue={e.slug} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={anyRegs > 0} aria-describedby="e-sl-h" />
            <span className="hint" id="e-sl-h">{anyRegs > 0 ? t("slugLockedHint") : t("slugHint")}</span></div>
          <div className="adm-form-foot">
            {e.cancelledAt ? <span className="small muted">{t("cancelledNoPublish")}</span>
              : <label className="check"><input type="checkbox" name="published" defaultChecked={e.published} /> <span>{t("publishedLabel")}</span></label>}
            <button className="btn btn-accent">{t("save")}</button>
          </div>
        </form>

        <section className="card adm-section" id="danger" aria-labelledby="h-danger">
          <h2 id="h-danger" style={h2}>{t("dangerTitle")}</h2>
          {e.cancelledAt ? (<>
            <p className="small" style={{ margin: 0 }}>{t("restoreBody")}</p>
            <form action={restoreEvent}>{hid}<button className="btn btn-secondary btn-sm">{t("restoreBtn")}</button></form>
          </>) : (<>
            <p className="small" style={{ margin: 0 }}>{t("cancelBody")}</p>
            <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("cancelBtn")}…</summary>
              <form action={cancelEvent}>{hid}<p className="small" style={{ margin: 0 }}>{t("cancelConfirm", { title: v.title })}</p><button className="btn btn-danger btn-sm">{t("cancelYes")}</button></form>
            </details>
          </>)}
          {anyRegs === 0 ? (<>
            <p className="small" style={{ margin: 0 }}>{t("deleteBody")}</p>
            <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("deleteBtn")}…</summary>
              <form action={deleteEvent}>{hid}<p className="small" style={{ margin: 0 }}>{t("deleteConfirm", { title: v.title })}</p><button className="btn btn-danger btn-sm">{t("deleteYes")}</button></form>
            </details>
          </>) : <p className="small muted" style={{ margin: 0 }}>{t("deleteBlocked")}</p>}
        </section>
      </main>
    </div>
  );
}
