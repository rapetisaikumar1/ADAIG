import { expireUnpaid } from "@/lib/membership";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { getTier, type Locale } from "@/config/site";
import { reviewEligibility, markRefunded, unlockAccount, setRole } from "./actions";
export const dynamic = "force-dynamic";

export default async function AdminMembers({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const me = await requireAdmin(locale); const t = await getTranslations("admin"); const { q, msg } = await searchParams;
  // BUG-039: search is literal. SQLite LIKE treats % and _ as wildcards and Prisma can't add ESCAPE, so filter in code (fine at MVP scale).
  const needle = (q ?? "").trim().toLowerCase().slice(0, 200);
  await expireUnpaid(); // BUG-042 lazy expiry (all users)
  const all = await db.user.findMany({ where: { role: { not: "deleted" } }, include: { memberships: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } });
  const users = needle ? all.filter((u) => [u.name, u.email, u.organisation ?? ""].some((f) => f.toLowerCase().includes(needle))) : all;
  const locks = new Set((await db.loginThrottle.findMany({ where: { lockedUntil: { gt: new Date() } } })).map((r) => r.key.slice(2)));
  const adminCount = await db.user.count({ where: { role: "admin" } });
  const tx = (k: string) => (t.has(k) ? t(k) : k.replace(/^\w+_/, ""));
  const hid = (id: string) => <><input type="hidden" name="id" value={id} /><input type="hidden" name="locale" value={locale} /></>;
  return (
    <div className="app"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" className="app-main">
        <div className="app-head"><h1>{t("membersTitle")}</h1><a className="btn btn-secondary btn-sm" href="/api/admin/members.csv">{t("exportCsv")}</a></div>
        {msg && ["unlocked", "roleChanged", "lastAdmin", "alreadyDecided"].includes(msg) && <div className={`alert ${msg === "lastAdmin" || msg === "alreadyDecided" ? "alert-danger" : "alert-success"}`} role="status" style={{ marginBottom: 16 }}><div>{t(msg)}</div></div>}
        <form className="search-bar" style={{ marginBottom: 16 }} role="search"><label htmlFor="q" className="sr-only">{t("search")}</label><input id="q" name="q" type="search" defaultValue={q} placeholder={t("searchPh")} /><button className="btn btn-secondary btn-sm">{t("search")}</button></form>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")}><table><caption className="sr-only">{t("membersTitle")}</caption><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("email")}</th><th scope="col">{t("role")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("status")}</th><th scope="col">{t("org")}</th><th scope="col">{t("eligibility")}</th><th scope="col">{t("account")}</th></tr></thead><tbody>
          {users.map((u) => { const m = u.memberships[0]; const isLocked = locks.has(u.email); return (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{tx(`role_${u.role}`)}</td><td>{m ? getTier(m.tierId)?.name[locale] : "—"}</td><td>{m ? <span className={`badge ${m.status === "active" ? "badge-green" : "badge-amber"}`}>{tx(`status_${m.status}`)}</span> : "—"}</td><td>{u.organisation}</td><td>{m?.status === "pending_verification" ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><span className="small">{m.eligibilityNote}</span>
                {(["approve", "reject"] as const).map((d) => (
                  <form key={d} action={reviewEligibility}>{hid(m.id)}<input type="hidden" name="decision" value={d} />{d === "reject" && <><label className="sr-only" htmlFor={`rr-${m.id}`}>{t("reasonLabel")}</label><input id={`rr-${m.id}`} name="reason" type="text" placeholder={t("reasonPh")} style={{ minWidth: 160 }} /></>}
                    <button className={`btn ${d === "approve" ? "btn-accent" : "btn-secondary"} btn-sm`}>{t(d)}</button></form>
                ))}</div>
            ) : m?.status === "rejected_verification" ? (
              <div className="small">{t("rejected")}{locale === "fr" ? " : " : ": "}{m.rejectionReason}{m.refundStatus === "refund_due" && <form action={markRefunded} style={{ marginTop: 6 }}><span className="badge badge-amber">{t("refundDue")}</span> {hid(m.id)}<button className="btn btn-secondary btn-sm">{t("markRefunded")}</button></form>}{m.refundStatus === "refunded" && <> · <span className="badge badge-green">{t("refunded")}</span></>}</div>
            ) : m?.refundStatus === "refund_due" ? <form action={markRefunded}><span className="badge badge-amber">{t("refundDue")}</span> {hid(m.id)}<button className="btn btn-secondary btn-sm">{t("markRefunded")}</button></form> : m?.verifiedAt ? <span className="small">{t("verified")}</span> : "—"}</td>
            <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {isLocked && <span className="badge badge-red">{t("locked")}</span>}
              {isLocked && <form action={unlockAccount}>{hid(u.id)}<button className="btn btn-secondary btn-sm">{t("unlock")}</button></form>}
              {u.role === "admin"
                ? !(adminCount <= 1) && <form action={setRole}>{hid(u.id)}<input type="hidden" name="role" value="member" /><button className="btn btn-ghost btn-sm" aria-label={`${t("removeAdmin")}: ${u.name}`}>{t("removeAdmin")}{u.id === me.id ? (locale === "fr" ? " (vous)" : " (you)") : ""}</button></form>
                : <form action={setRole}>{hid(u.id)}<input type="hidden" name="role" value="admin" /><button className="btn btn-ghost btn-sm" aria-label={`${t("makeAdmin")}: ${u.name}`}>{t("makeAdmin")}</button></form>}
            </div></td></tr>
          ); })}
        </tbody></table></div>
      </main>
    </div>
  );
}
