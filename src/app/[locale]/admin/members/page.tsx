import { membershipHousekeeping, LAPSE_GRACE_DAYS } from "@/lib/membership";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { reviewEligibility, markRefunded, unlockAccount, setRole } from "./actions";
import {
  MEMBER_FILTERS, memberFilter, memberQuery, memberSearchWhere, memberTabWhere, NOT_PENDING_WHERE, badgeFor,
  LIST_USER_SELECT, LIST_MEMBERSHIP_SELECT, type MemberFilter,
} from "./_shared";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const MSGS: Record<string, "alert-success" | "alert-danger"> = { unlocked: "alert-success", roleChanged: "alert-success", approved: "alert-success", rejectedOk: "alert-success", refundedOk: "alert-success", lastAdmin: "alert-danger", alreadyDecided: "alert-danger" };
/** Notices from the account page / new-account flow (adminMembers namespace). */
const MSGS_MEMBERS: Record<string, "alert-success" | "alert-danger"> = { accountDeleted: "alert-success", notFound: "alert-danger" };

type ListUser = { id: string; name: string; email: string; organisation: string | null; role: string; createdAt: Date };
type ListMembership = { id: string; tierId: string; status: string; createdAt: Date; verifiedAt: Date | null; renewsAt: Date | null; eligibilityNote: string | null; rejectionReason: string | null; refundStatus: string | null };
type Row = { u: ListUser; m?: ListMembership };

/**
 * Admin → Members: tabs, search and counts run in the database (literal, case-insensitive search), 50 rows per page, only the
 * displayed columns are read. Applications awaiting review come first (oldest first), then everyone else (newest account first).
 */
export default async function AdminMembers({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string; msg?: string; f?: string; p?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const me = await requireAdmin(locale); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers"); const sp = await searchParams;
  const msg = sp.msg;
  const filter: MemberFilter = memberFilter(sp.f);
  const needle = memberQuery(sp.q);
  const W = memberSearchWhere(needle);
  const countList = await Promise.all(MEMBER_FILTERS.map((k) => db.user.count({ where: { AND: [W, memberTabWhere(k)] } })));
  const counts = Object.fromEntries(MEMBER_FILTERS.map((k, i) => [k, countList[i]])) as Record<MemberFilter, number>;
  const total = counts[filter];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(Number(sp.p) || 1)), pages);
  const start = (page - 1) * PAGE_SIZE, end = start + PAGE_SIZE;

  const userSelect = { ...LIST_USER_SELECT, memberships: { orderBy: { createdAt: "desc" as const }, take: 1, select: LIST_MEMBERSHIP_SELECT } };
  const pendingRows = async (skip: number, take: number): Promise<Row[]> => take <= 0 ? [] :
    (await db.membership.findMany({ where: { status: "pending_verification", user: W }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take, select: { ...LIST_MEMBERSHIP_SELECT, user: { select: LIST_USER_SELECT } } }))
      .map(({ user, ...m }) => ({ u: user, m }));
  const userRows = async (where: object, skip: number, take: number): Promise<Row[]> => take <= 0 ? [] :
    (await db.user.findMany({ where: { AND: [W, where] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take, select: userSelect }))
      .map(({ memberships, ...u }) => ({ u, m: memberships[0] }));

  let rows: Row[];
  if (filter === "pending") rows = await pendingRows(start, PAGE_SIZE);
  else if (filter === "all") {
    // One virtual list: applications awaiting review (oldest first), then everyone else (newest first).
    const nPending = counts.pending;
    const [a, b] = await Promise.all([
      pendingRows(start, Math.min(end, nPending) - start),
      userRows(NOT_PENDING_WHERE, Math.max(0, start - nPending), end - Math.max(start, nPending)),
    ]);
    rows = [...a, ...b];
  } else rows = await userRows(memberTabWhere(filter), start, PAGE_SIZE);

  // Housekeeping only for the people shown that need it (an old unpaid order, or an active membership past its grace period);
  // the daily job handles everyone else. Never run for all users on a page view.
  const lapseBefore = Date.now() - LAPSE_GRACE_DAYS * 864e5;
  const legacy = rows.filter((r) => r.m?.status === "pending" || (r.m?.status === "active" && !!r.m.renewsAt && +r.m.renewsAt < lapseBefore));
  if (legacy.length && (await Promise.all(legacy.map((r) => membershipHousekeeping(r.u.id)))).some((n) => n.expired + n.lapsed > 0)) {
    for (const r of legacy) r.m = (await db.membership.findFirst({ where: { userId: r.u.id }, orderBy: { createdAt: "desc" }, select: LIST_MEMBERSHIP_SELECT })) ?? undefined;
  }

  const [lockRows, adminCount, getTier] = await Promise.all([
    rows.length ? db.loginThrottle.findMany({ where: { key: { in: rows.map((r) => `e:${r.u.email}`) }, lockedUntil: { gt: new Date() } }, select: { key: true } }) : [],
    db.user.count({ where: { role: "admin" } }),
    tierLookup(), // admin-editable tier names (Admin → Settings)
  ]);
  const locks = new Set(lockRows.map((r) => r.key.slice(2)));
  const tx = (k: string) => (t.has(k) ? t(k) : k.replace(/^\w+_/, ""));
  const dl = dateLocale(locale);
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  const colon = locale === "fr" ? " : " : ": ";
  // An application note is about the tier applied for: after a change to a tier without an eligibility check it is shown as "earlier".
  const note = (m: ListMembership) => !m.eligibilityNote ? null : getTier(m.tierId)?.requiresVerification ? m.eligibilityNote : t("noteEarlier", { note: m.eligibilityNote });
  // The review column only matters while someone in the list is awaiting review, was rejected or is owed a refund.
  const needsReview = (r: Row) => !!r.m && (r.m.status === "pending_verification" || r.m.status === "rejected_verification" || r.m.refundStatus === "refund_due");
  const showReview = rows.some(needsReview);
  const cols = showReview ? 5 : 4;
  const hid = (id: string) => <><input type="hidden" name="id" value={id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="f" value={filter} /><input type="hidden" name="q" value={needle} />{page > 1 && <input type="hidden" name="p" value={page} />}</>;
  const qs = (k: MemberFilter, p = 1) => { const s = new URLSearchParams(); if (k !== "all") s.set("f", k); if (needle) s.set("q", needle); if (p > 1) s.set("p", String(p)); return s.toString(); };
  const href = (k: MemberFilter, p = 1) => { const s = qs(k, p); return `/${locale}/admin/members${s ? `?${s}` : ""}`; };
  const csv = `/api/admin/members.csv${qs(filter) ? `?${qs(filter)}` : ""}`;
  const refund = (m: ListMembership, u: ListUser) => (
    <details className="adm-confirm"><summary className="btn btn-secondary btn-sm" aria-label={`${t("markRefunded")}: ${u.name}`}>{t("markRefunded")}…</summary>
      <form action={markRefunded}>{hid(m.id)}<p className="small" style={{ margin: 0 }}>{t("markRefundedConfirm", { name: u.name })}</p><button className="btn btn-primary btn-sm">{t("markRefundedYes")}</button></form>
    </details>
  );
  const first = total ? start + 1 : 0, last = Math.min(end, total);
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" className="app-main">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("membersTitle")}</h1></div>
          <div className="adm-actions"><a className="btn btn-secondary btn-sm" href={csv} download>{t("exportCsvN", { n: total })}</a><a className="btn btn-primary btn-sm" href={`/${locale}/admin/members/new`}>+ {tm("newAccount")}</a></div></div>
        {msg && MSGS[msg] && <div className={`alert ${MSGS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{t(msg)}</div></div>}
        {msg && MSGS_MEMBERS[msg] && <div className={`alert ${MSGS_MEMBERS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{tm(`list_${msg}` as "list_notFound")}</div></div>}
        <div className="adm-toolbar">
          <nav className="adm-filters" aria-label={t("filterLabel")}>{MEMBER_FILTERS.map((k) => <a key={k} href={href(k)} aria-current={filter === k ? "page" : undefined} title={k === "other" ? t("f_otherHint") : undefined}>{t(`f_${k}`)} <span className="adm-n">{counts[k]}</span></a>)}</nav>
          <form className="search-bar" role="search">{filter !== "all" && <input type="hidden" name="f" value={filter} />}<label htmlFor="q" className="sr-only">{t("search")}</label><input id="q" name="q" type="search" defaultValue={needle} maxLength={200} placeholder={t("searchPh")} /><button className="btn btn-secondary btn-sm">{t("search")}</button></form>
        </div>
        {total > PAGE_SIZE && <p className="small muted adm-count" role="status">{t("showingN", { first, last, total })}</p>}
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")}><table className="adm-table adm-stack adm-table-members"><caption className="sr-only">{t("membersTitle")}</caption><thead><tr><th scope="col">{t("person")}</th><th scope="col">{t("role")}</th><th scope="col">{t("membership")}</th>{showReview && <th scope="col">{t("eligibility")}</th>}<th scope="col">{t("account")}</th></tr></thead><tbody>
          {rows.length === 0 && <tr><td colSpan={cols} className="muted" style={{ textAlign: "center", padding: 32 }}>{filter === "pending" && !needle ? t("noPending") : t("noResults")}</td></tr>}
          {rows.map(({ u, m }) => { const isLocked = locks.has(u.email); const pend = m?.status === "pending_verification"; return (
            <tr key={u.id} className={pend ? "is-pending" : undefined}>
              <td data-label={t("person")}><div className="adm-person"><b><a href={`/${locale}/admin/members/${u.id}`} aria-label={`${u.name}: ${tm("openAccount")}`}>{u.name}</a></b><span className="small">{u.email}</span>{u.organisation && <span className="small muted">{u.organisation}</span>}</div></td>
              <td data-label={t("role")}>{tx(`role_${u.role}`)}</td>
              <td data-label={t("membership")}>{m ? <div className="adm-person"><span>{getTier(m.tierId)?.name[locale] ?? m.tierId}</span><span><span className={`badge ${badgeFor(m.status)}`}>{tx(`status_${m.status}`)}</span></span>{m.status === "active" && m.verifiedAt && <span className="small muted">{t("approvedOn", { date: day(m.verifiedAt) })}</span>}</div> : <span className="muted">{t("noMembership")}</span>}</td>
              {showReview && <td data-label={t("eligibility")}>{m && pend ? (
                <div className="adm-review">
                  <span className="small">{t("appliedOn", { date: day(m.createdAt) })}{note(m) ? <><br /><span className="muted">{note(m)}</span></> : null}</span>
                  <div className="adm-actions">
                    <form action={reviewEligibility}>{hid(m.id)}<input type="hidden" name="decision" value="approve" /><button className="btn btn-accent btn-sm" aria-label={`${t("approve")}: ${u.name}`}>{t("approve")}</button></form>
                    <details className="adm-reject"><summary className="btn btn-secondary btn-sm" aria-label={`${t("reject")}: ${u.name}`}>{t("reject")}…</summary>
                      <form action={reviewEligibility}>{hid(m.id)}<input type="hidden" name="decision" value="reject" /><label className="small" htmlFor={`rr-${m.id}`}>{t("reasonLabel")}</label><input id={`rr-${m.id}`} name="reason" type="text" placeholder={t("reasonPh")} maxLength={300} /><button className="btn btn-danger btn-sm">{t("confirmReject")}</button></form>
                    </details>
                  </div>
                </div>
              ) : m?.status === "rejected_verification" ? (
                <div className="small adm-person"><span>{t("rejected")}{colon}{m.rejectionReason || t("noReason")}</span>{m.refundStatus === "refund_due" && <><span><span className="badge badge-amber">{t("refundDue")}</span></span>{refund(m, u)}</>}{m.refundStatus === "refunded" && <span><span className="badge badge-green">{t("refunded")}</span></span>}</div>
              ) : m?.refundStatus === "refund_due" ? <div className="adm-person"><span><span className="badge badge-amber">{t("refundDue")}</span></span>{refund(m, u)}</div>
                : <span className="muted">—</span>}</td>}
              <td data-label={t("account")}><div className="adm-actions">
                {isLocked && <span className="badge badge-red">{t("locked")}</span>}
                {isLocked && <form action={unlockAccount}>{hid(u.id)}<button className="btn btn-secondary btn-sm" aria-label={`${t("unlock")}: ${u.name}`}>{t("unlock")}</button></form>}
                {u.role === "admin"
                  ? u.id === me.id ? <span className="small muted">{t("you")}</span>
                    : adminCount > 1 && <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm" aria-label={`${t("removeAdmin")}: ${u.name}`}>{t("removeAdmin")}…</summary>
                      <form action={setRole}>{hid(u.id)}<input type="hidden" name="role" value="member" /><p className="small" style={{ margin: 0 }}>{t("removeAdminConfirm", { name: u.name })}</p><button className="btn btn-danger btn-sm">{t("removeAdminYes")}</button></form>
                    </details>
                  : <details className="adm-confirm"><summary className="btn btn-secondary btn-sm" aria-label={`${t("makeAdmin")}: ${u.name}`}>{t("makeAdmin")}…</summary>
                      <form action={setRole}>{hid(u.id)}<input type="hidden" name="role" value="admin" /><p className="small" style={{ margin: 0 }}>{t("makeAdminConfirm", { name: u.name })}</p><button className="btn btn-primary btn-sm">{t("makeAdminYes")}</button></form>
                    </details>}
              </div></td></tr>
          ); })}
        </tbody></table></div>
        {pages > 1 && (
          <nav aria-label={t("pagination")} className="adm-pager">
            {page > 1 ? <a className="btn btn-secondary btn-sm" href={href(filter, page - 1)} rel="prev">← {t("prevPage")}</a> : <span />}
            <span className="small muted">{t("pageOf", { page, pages })}</span>
            {page < pages ? <a className="btn btn-secondary btn-sm" href={href(filter, page + 1)} rel="next">{t("nextPage")} →</a> : <span />}
          </nav>
        )}
      </main>
    </div>
  );
}
