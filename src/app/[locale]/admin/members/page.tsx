import { expireUnpaid } from "@/lib/membership";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { searchParam } from "@/lib/validation";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { type Locale } from "@/config/site";
import { tierLookup } from "@/lib/settings";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
import { reviewEligibility, markRefunded, unlockAccount, setRole } from "./actions";
export const dynamic = "force-dynamic";

const FILTERS = ["all", "pending", "active", "other"] as const;
type Filter = (typeof FILTERS)[number];
const MSGS: Record<string, "alert-success" | "alert-danger"> = { unlocked: "alert-success", roleChanged: "alert-success", approved: "alert-success", rejectedOk: "alert-success", lastAdmin: "alert-danger", alreadyDecided: "alert-danger" };
/** Notices from the account page / new-account flow (adminMembers namespace). */
const MSGS_MEMBERS: Record<string, "alert-success" | "alert-danger"> = { accountDeleted: "alert-success", notFound: "alert-danger" };
const badgeFor = (s: string) => s === "active" ? "badge-green" : s === "pending_verification" ? "badge-amber" : s === "rejected_verification" ? "badge-red" : "";

export default async function AdminMembers({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string; msg?: string; f?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const me = await requireAdmin(locale); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers"); const { q, msg, f } = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(f ?? "") ? (f as Filter) : "all";
  // BUG-039: search is literal. SQLite LIKE treats % and _ as wildcards and Prisma can't add ESCAPE, so filter in code (fine at MVP scale).
  const needle = searchParam(q, 200).toLowerCase();
  await expireUnpaid(); // BUG-042 lazy expiry (all users)
  const all = await db.user.findMany({ where: { role: { not: "deleted" } }, include: { memberships: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } });
  const st = (u: (typeof all)[number]) => u.memberships[0]?.status;
  const inFilter = (u: (typeof all)[number], k: Filter) => k === "all" || (k === "pending" ? st(u) === "pending_verification" : k === "active" ? st(u) === "active" : st(u) !== "pending_verification" && st(u) !== "active");
  const searched = needle ? all.filter((u) => [u.name, u.email, u.organisation ?? ""].some((x) => x.toLowerCase().includes(needle))) : all;
  // applications awaiting review first (oldest first), then everyone else newest first
  const users = searched.filter((u) => inFilter(u, filter)).sort((a, b) => {
    const pa = st(a) === "pending_verification", pb = st(b) === "pending_verification";
    if (pa !== pb) return pa ? -1 : 1;
    return pa ? +a.memberships[0].createdAt - +b.memberships[0].createdAt : 0;
  });
  const counts = Object.fromEntries(FILTERS.map((k) => [k, searched.filter((u) => inFilter(u, k)).length])) as Record<Filter, number>;
  const locks = new Set((await db.loginThrottle.findMany({ where: { lockedUntil: { gt: new Date() } } })).map((r) => r.key.slice(2)));
  const adminCount = await db.user.count({ where: { role: "admin" } });
  const tx = (k: string) => (t.has(k) ? t(k) : k.replace(/^\w+_/, ""));
  const getTier = await tierLookup(); // admin-editable tier names (Admin → Settings)
  const dl = dateLocale(locale);
  const day = (d: Date) => d.toLocaleDateString(dl, { day: "numeric", month: "short", year: "numeric", timeZone: eventTimeZone });
  // The review column only matters while someone in the list is awaiting review, was rejected or is owed a refund.
  const needsReview = (u: (typeof users)[number]) => { const m = u.memberships[0]; return !!m && (m.status === "pending_verification" || m.status === "rejected_verification" || m.refundStatus === "refund_due"); };
  const showReview = users.some(needsReview);
  const cols = showReview ? 5 : 4;
  const hid = (id: string) => <><input type="hidden" name="id" value={id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="f" value={filter} /></>;
  const href = (k: Filter) => { const p = new URLSearchParams(); if (k !== "all") p.set("f", k); if (q) p.set("q", q); const s = p.toString(); return `/${locale}/admin/members${s ? `?${s}` : ""}`; };
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" className="app-main">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("membersTitle")}</h1></div><div className="adm-actions"><a className="btn btn-secondary btn-sm" href="/api/admin/members.csv">{t("exportCsv")}</a><a className="btn btn-primary btn-sm" href={`/${locale}/admin/members/new`}>+ {tm("newAccount")}</a></div></div>
        {msg && MSGS[msg] && <div className={`alert ${MSGS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{t(msg)}</div></div>}
        {msg && MSGS_MEMBERS[msg] && <div className={`alert ${MSGS_MEMBERS[msg]}`} role="status" style={{ marginBottom: 16 }}><div>{tm(`list_${msg}` as "list_notFound")}</div></div>}
        <div className="adm-toolbar">
          <nav className="adm-filters" aria-label={t("filterLabel")}>{FILTERS.map((k) => <a key={k} href={href(k)} aria-current={filter === k ? "page" : undefined}>{t(`f_${k}`)} <span className="adm-n">{counts[k]}</span></a>)}</nav>
          <form className="search-bar" role="search">{filter !== "all" && <input type="hidden" name="f" value={filter} />}<label htmlFor="q" className="sr-only">{t("search")}</label><input id="q" name="q" type="search" defaultValue={q} placeholder={t("searchPh")} /><button className="btn btn-secondary btn-sm">{t("search")}</button></form>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")}><table className="adm-table adm-stack"><caption className="sr-only">{t("membersTitle")}</caption><thead><tr><th scope="col">{t("person")}</th><th scope="col">{t("role")}</th><th scope="col">{t("membership")}</th>{showReview && <th scope="col">{t("eligibility")}</th>}<th scope="col">{t("account")}</th></tr></thead><tbody>
          {users.length === 0 && <tr><td colSpan={cols} className="muted" style={{ textAlign: "center", padding: 32 }}>{filter === "pending" && !needle ? t("noPending") : t("noResults")}</td></tr>}
          {users.map((u) => { const m = u.memberships[0]; const isLocked = locks.has(u.email); const pend = m?.status === "pending_verification"; return (
            <tr key={u.id} className={pend ? "is-pending" : undefined}>
              <td data-label={t("person")}><div className="adm-person"><b><a href={`/${locale}/admin/members/${u.id}`} aria-label={`${u.name}: ${tm("openAccount")}`}>{u.name}</a></b><span className="small">{u.email}</span>{u.organisation && <span className="small muted">{u.organisation}</span>}</div></td>
              <td data-label={t("role")}>{tx(`role_${u.role}`)}</td>
              <td data-label={t("membership")}>{m ? <div className="adm-person"><span>{getTier(m.tierId)?.name[locale] ?? m.tierId}</span><span><span className={`badge ${badgeFor(m.status)}`}>{tx(`status_${m.status}`)}</span></span>{m.status === "active" && m.verifiedAt && <span className="small muted">{t("approvedOn", { date: day(m.verifiedAt) })}</span>}</div> : <span className="muted">{t("noMembership")}</span>}</td>
              {showReview && <td data-label={t("eligibility")}>{pend ? (
                <div className="adm-review">
                  <span className="small">{t("appliedOn", { date: day(m.createdAt) })}{m.eligibilityNote ? <><br /><span className="muted">{m.eligibilityNote}</span></> : null}</span>
                  <div className="adm-actions">
                    <form action={reviewEligibility}>{hid(m.id)}<input type="hidden" name="decision" value="approve" /><button className="btn btn-accent btn-sm" aria-label={`${t("approve")}: ${u.name}`}>{t("approve")}</button></form>
                    <details className="adm-reject"><summary className="btn btn-secondary btn-sm">{t("reject")}…</summary>
                      <form action={reviewEligibility}>{hid(m.id)}<input type="hidden" name="decision" value="reject" /><label className="small" htmlFor={`rr-${m.id}`}>{t("reasonLabel")}</label><input id={`rr-${m.id}`} name="reason" type="text" placeholder={t("reasonPh")} maxLength={300} /><button className="btn btn-danger btn-sm">{t("confirmReject")}</button></form>
                    </details>
                  </div>
                </div>
              ) : m?.status === "rejected_verification" ? (
                <div className="small">{t("rejected")}{locale === "fr" ? " : " : ": "}{m.rejectionReason}{m.refundStatus === "refund_due" && <form action={markRefunded} style={{ marginTop: 6 }}><span className="badge badge-amber">{t("refundDue")}</span> {hid(m.id)}<button className="btn btn-secondary btn-sm">{t("markRefunded")}</button></form>}{m.refundStatus === "refunded" && <> · <span className="badge badge-green">{t("refunded")}</span></>}</div>
              ) : m?.refundStatus === "refund_due" ? <form action={markRefunded}><span className="badge badge-amber">{t("refundDue")}</span> {hid(m.id)}<button className="btn btn-secondary btn-sm">{t("markRefunded")}</button></form>
                : <span className="muted">—</span>}</td>}
              <td data-label={t("account")}><div className="adm-actions">
                {isLocked && <span className="badge badge-red">{t("locked")}</span>}
                {isLocked && <form action={unlockAccount}>{hid(u.id)}<button className="btn btn-secondary btn-sm">{t("unlock")}</button></form>}
                {u.role === "admin"
                  ? u.id === me.id ? <span className="small muted">{t("you")}</span>
                    : adminCount > 1 && <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm" aria-label={`${t("removeAdmin")}: ${u.name}`}>{t("removeAdmin")}…</summary>
                      <form action={setRole}>{hid(u.id)}<input type="hidden" name="role" value="member" /><p className="small" style={{ margin: 0 }}>{t("removeAdminConfirm", { name: u.name })}</p><button className="btn btn-danger btn-sm">{t("removeAdminYes")}</button></form>
                    </details>
                  : <form action={setRole}>{hid(u.id)}<input type="hidden" name="role" value="admin" /><button className="btn btn-secondary btn-sm" aria-label={`${t("makeAdmin")}: ${u.name}`}>{t("makeAdmin")}</button></form>}
              </div></td></tr>
          ); })}
        </tbody></table></div>
      </main>
    </div>
  );
}
