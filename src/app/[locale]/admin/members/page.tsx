import { membershipHousekeeping, LAPSE_GRACE_DAYS } from "@/lib/membership";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Facet";
import { AdminHead, AdminTabs, AdminSearch, AdminEmpty, AdminReadOnly, Email, type TabItem } from "../_components/AdminUI";
import { type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { reviewEligibility, markRefunded, unlockAccount } from "./actions";
import {
  MEMBER_FILTERS, memberFilter, memberQuery, memberSearchWhere, memberTabWhere, NOT_PENDING_WHERE, statusFor,
  LIST_USER_SELECT, LIST_MEMBERSHIP_SELECT, type MemberFilter,
} from "./_shared";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const MSGS: Record<string, "alert-success" | "alert-danger"> = { unlocked: "alert-success", approved: "alert-success", rejectedOk: "alert-success", refundedOk: "alert-success", alreadyDecided: "alert-danger" };
/** Notices from the account page / new-account flow (adminMembers namespace). */
const MSGS_MEMBERS: Record<string, "alert-success" | "alert-danger"> = { accountDeleted: "alert-success", notFound: "alert-danger" };

type ListUser = { id: string; name: string; email: string; organisation: string | null; role: string; createdAt: Date };
type ListMembership = { id: string; tierId: string; status: string; createdAt: Date; verifiedAt: Date | null; renewsAt: Date | null; eligibilityNote: string | null; rejectionReason: string | null; refundStatus: string | null };
type Row = { u: ListUser; m?: ListMembership };

/**
 * Admin → Members: tabs, search and counts run in the database (literal, case-insensitive search), 50 rows per page, only the
 * displayed columns are read. Applications awaiting review come first (oldest first), then everyone else (newest account first).
 * Association accounts only (guests and members): Admin Portal accounts are managed in Users (round 7, D1; memberSearchWhere).
 * Controls follow the role's permissions (members.create / edit); the server actions check them again.
 */
export default async function AdminMembers({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string; msg?: string; f?: string; p?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "members", "view"); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers"); const sp = await searchParams;
  const msg = sp.msg;
  const canCreate = can(ctx, "members", "create"), canEdit = can(ctx, "members", "edit");
  const readOnly = !canCreate && !canEdit; // view only: one notice, neutral copy (no "Review now")
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

  const [lockRows, getTier] = await Promise.all([
    rows.length ? db.loginThrottle.findMany({ where: { key: { in: rows.map((r) => `e:${r.u.email}`) }, lockedUntil: { gt: new Date() } }, select: { key: true } }) : [],
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
  // The actions column only exists when there is something this role may do in it (today: unlock a locked account).
  const showActions = canEdit && rows.some((r) => locks.has(r.u.email));
  const hid = (id: string) => <><input type="hidden" name="id" value={id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="f" value={filter} /><input type="hidden" name="q" value={needle} />{page > 1 && <input type="hidden" name="p" value={page} />}</>;
  const qs = (k: MemberFilter, p = 1) => { const s = new URLSearchParams(); if (k !== "all") s.set("f", k); if (needle) s.set("q", needle); if (p > 1) s.set("p", String(p)); return s.toString(); };
  const href = (k: MemberFilter, p = 1) => { const s = qs(k, p); return `/${locale}/admin/members${s ? `?${s}` : ""}`; };
  const csv = `/api/admin/members.csv${qs(filter) ? `?${qs(filter)}` : ""}`;
  const refund = (m: ListMembership, u: ListUser) => !canEdit ? null : (
    <details className="confirm adm-confirm"><summary className="btn btn-secondary btn-sm" aria-label={`${t("markRefunded")}: ${u.name}`}>{t("markRefunded")}…</summary>
      <form action={markRefunded} className="confirm-box">{hid(m.id)}<p>{t("markRefundedConfirm", { name: u.name })}</p><div className="confirm-actions"><button className="btn btn-primary btn-sm">{t("markRefundedYes")}</button></div></form>
    </details>
  );
  const first = total ? start + 1 : 0, last = Math.min(end, total);
  const tabs: TabItem[] = MEMBER_FILTERS.map((k) => ({ key: k, href: href(k), label: t(`f_${k}`), count: counts[k], current: filter === k, title: k === "other" ? t("f_otherHint") : undefined }));
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" tabIndex={-1} className="app-main adm-members">
        <AdminHead title={t("membersTitle")} lead={readOnly ? t("membersLeadRO") : t("membersLead")}
          actions={<><a className="btn btn-secondary btn-sm" href={csv} download><Icon name="download" size={16} />{t("exportCsvN", { n: total })}</a>{canCreate && <a className="btn btn-primary btn-sm" href={`/${locale}/admin/members/new`}><Icon name="plus" size={16} />{tm("newAccount")}</a>}</>} />
        {msg && MSGS[msg] && <FocusOnLoad><div className={`alert ${MSGS[msg]} adm-notice`} role="status"><div>{t(msg)}</div></div></FocusOnLoad>}
        {msg && MSGS_MEMBERS[msg] && <FocusOnLoad><div className={`alert ${MSGS_MEMBERS[msg]} adm-notice`} role="status"><div>{tm(`list_${msg}` as "list_notFound")}</div></div></FocusOnLoad>}
        {readOnly && <AdminReadOnly text={t("readOnly")} />}
        {filter !== "pending" && counts.pending > 0 && !needle && (
          <a className="adm-attn" href={href("pending")}><span className="adm-attn-n">{counts.pending}</span><span>{t("pendingKpi")}</span><span className="adm-attn-go">{canEdit ? t("reviewNow") : t("seeApplications")}<Icon name="arrow-right" size={16} /></span></a>
        )}
        <AdminTabs label={t("filterLabel")} items={tabs} />
        <div className="table-toolbar">
          <AdminSearch id="q" value={needle} label={t("search")} placeholder={t("searchPh")} placeholderShort={t("searchPhShort")} hidden={{ f: filter !== "all" ? filter : undefined }} button={t("search")} />
          <div className="toolbar-actions"><span className="small muted adm-count" role="status">{total > PAGE_SIZE ? t("showingN", { first, last, total }) : null}</span></div>
        </div>
        {rows.length === 0 ? (
          needle ? <AdminEmpty title={t("noResults")} action={<a className="btn btn-secondary btn-sm" href={href(filter)}>{t("f_all")}</a>}><q>{needle}</q></AdminEmpty>
            : <AdminEmpty title={filter === "pending" ? t("noPending") : t("noResults")} />
        ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("scrollRegion", { name: t("membersTitle") })}><table className="adm-table adm-stack adm-table-members"><caption className="sr-only">{t("membersTitle")}</caption><thead><tr><th scope="col">{t("person")}</th><th scope="col">{t("membership")}</th>{showReview && <th scope="col">{t("eligibility")}</th>}{showActions && <th scope="col" className="adm-col-actions">{t("account")}</th>}</tr></thead><tbody>
          {rows.map(({ u, m }) => { const isLocked = locks.has(u.email); const pend = m?.status === "pending_verification"; const review = needsReview({ u, m }); return (
            <tr key={u.id} className={pend ? "is-pending" : undefined}>
              <td data-label={t("person")} className="adm-cell-person"><div className="adm-who"><Avatar name={u.name} size="sm" tone={pend ? "amber" : undefined} /><div className="adm-person"><span className="adm-name-line"><a href={`/${locale}/admin/members/${u.id}`} aria-label={`${u.name}: ${tm("openAccount")}`}>{u.name}</a><span className="badge adm-role">{tx(`role_${u.role}`)}</span>{isLocked && <span className="status status-danger">{t("locked")}</span>}</span><span className="small adm-email"><Email value={u.email} />{u.organisation && <span className="muted"> · {u.organisation}</span>}</span></div></div></td>
              <td data-label={t("membership")}>{m ? <div className="adm-person"><span>{getTier(m.tierId)?.name[locale] ?? m.tierId}</span><span><span className={`status ${statusFor(m.status)}`}>{tx(`status_${m.status}`)}</span></span>{m.status === "active" && m.verifiedAt && <span className="small muted">{t("approvedOn", { date: day(m.verifiedAt) })}</span>}</div> : <span className="muted">{t("noMembership")}</span>}</td>
              {showReview && <td data-label={t("eligibility")} className={review ? "span-all" : "adm-cell-empty"}>{m && pend ? (
                <div className="adm-review">
                  <span className="small">{t("appliedOn", { date: day(m.createdAt) })}{note(m) ? <><br /><span className="muted">{note(m)}</span></> : null}</span>
                  {canEdit && <div className="adm-actions">
                    <form action={reviewEligibility}>{hid(m.id)}<input type="hidden" name="decision" value="approve" /><button className="btn btn-accent btn-sm" aria-label={`${t("approve")}: ${u.name}`}><Icon name="check" size={16} />{t("approve")}</button></form>
                    <details className="confirm adm-confirm"><summary className="btn btn-secondary btn-sm" aria-label={`${t("reject")}: ${u.name}`}>{t("reject")}…</summary>
                      <form action={reviewEligibility} className="confirm-box">{hid(m.id)}<input type="hidden" name="decision" value="reject" /><div className="field"><label htmlFor={`rr-${m.id}`}>{t("reasonLabel")}</label><input id={`rr-${m.id}`} name="reason" type="text" placeholder={t("reasonPh")} maxLength={300} /></div><div className="confirm-actions"><button className="btn btn-danger btn-sm">{t("confirmReject")}</button></div></form>
                    </details>
                  </div>}
                </div>
              ) : m?.status === "rejected_verification" ? (
                <div className="small adm-person"><span>{t("rejected")}{colon}{m.rejectionReason || t("noReason")}</span>{m.refundStatus === "refund_due" && <><span><span className="status status-pending">{t("refundDue")}</span></span>{refund(m, u)}</>}{m.refundStatus === "refunded" && <span><span className="status status-available">{t("refunded")}</span></span>}</div>
              ) : m?.refundStatus === "refund_due" ? <div className="adm-person"><span><span className="status status-pending">{t("refundDue")}</span></span>{refund(m, u)}</div>
                : <span className="muted" aria-hidden="true">—</span>}</td>}
              {showActions && <td data-label={t("account")} className={isLocked ? "adm-col-actions" : "adm-col-actions adm-cell-empty"}>{isLocked
                ? <div className="adm-actions"><form action={unlockAccount}>{hid(u.id)}<button className="btn btn-secondary btn-sm" aria-label={`${t("unlock")}: ${u.name}`}>{t("unlock")}</button></form></div>
                : null}</td>}
            </tr>
          ); })}
        </tbody></table></div>)}
        {pages > 1 && (
          <nav aria-label={t("pagination")} className="table-foot adm-pager">
            {page > 1 ? <a className="btn btn-secondary btn-sm" href={href(filter, page - 1)} rel="prev">← {t("prevPage")}</a> : <span />}
            <span className="small muted">{t("pageOf", { page, pages })}</span>
            {page < pages ? <a className="btn btn-secondary btn-sm" href={href(filter, page + 1)} rel="next">{t("nextPage")} →</a> : <span />}
          </nav>
        )}
      </main>
    </div>
  );
}
