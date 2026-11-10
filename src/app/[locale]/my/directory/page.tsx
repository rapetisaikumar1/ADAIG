import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser, activeMembership } from "@/lib/session";
import { searchParam, likeLiteral } from "@/lib/validation";
import { MemberNav } from "@/components/AppShell";
import type { Locale } from "@/config/site";
import { initials } from "../_shared/util";
export const dynamic = "force-dynamic";

/**
 * Member directory (live data). Privacy: only users who opted in (Profile & privacy) AND hold an active membership
 * are listed, and only name, job title and organisation are shown. Browsing requires an active membership (or staff role).
 */
export default async function Directory({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const t = await getTranslations("member.directoryPage");
  const q = searchParam((await searchParams).q, 80); // control characters (Postgres rejects NUL) → spaces
  const L = (p: string) => `/${locale}${p}`;
  const canBrowse = u.role === "admin" || !!(await activeMembership(u.id));
  const pending = canBrowse ? null : await db.membership.findFirst({ where: { userId: u.id, status: "pending_verification" } });
  const ci = { contains: likeLiteral(q), mode: "insensitive" as const }; // case-insensitive, as on SQLite (name uses collation "C": ASCII case folding)
  const listedWhere = { directoryOptIn: true, deletedAt: null, role: { not: "deleted" }, memberships: { some: { status: "active" } } };
  const total = canBrowse ? await db.user.count({ where: listedWhere }) : 0;
  const people = canBrowse ? await db.user.findMany({
    where: { ...listedWhere, ...(q ? { OR: [{ name: ci }, { jobTitle: ci }, { organisation: ci }] } : {}) },
    select: { id: true, name: true, jobTitle: true, organisation: true }, orderBy: { name: "asc" }, take: 200,
  }) : [];
  return (
    <div className="app"><MemberNav locale={locale} current="/my/directory" />
      <main id="main" className="app-main mbr">
        <div className="app-head"><h1>{t("title")}</h1></div>
        <p className="lead mbr-lead">{t("lead")}</p>
        {/* When nobody is listed yet, the empty panel below carries the opt-in prompt instead of a separate banner. */}
        {canBrowse && total > 0 && <div className={`alert ${u.directoryOptIn ? "alert-success" : "alert-info"} mbr-alerts`} role="note"><div>{u.directoryOptIn ? t("youListed") : t("youHidden")} <a href={L("/my/profile")}>{t("change")}</a></div></div>}
        {!canBrowse ? (
          <div className="mbr-empty"><p><b>{t("membersOnly")}</b><br />{pending ? t("membersOnlyPending") : t("membersOnlyNone")}</p>{!pending && <a className="btn btn-secondary btn-sm" href={L("/membership")}>{t("joinLink")}</a>}</div>
        ) : total === 0 ? (
          <div className="mbr-empty"><p><b>{t("empty")}</b><br />{u.directoryOptIn ? t("youListed") : t("emptyBody")}</p>{!u.directoryOptIn && <a className="btn btn-secondary btn-sm" href={L("/my/profile")}>{t("optIn")}</a>}</div>
        ) : (<>
          <form className="search-bar mbr-search" role="search" method="get" action={L("/my/directory")}>
            <label htmlFor="ds" className="sr-only">{t("search")}</label>
            <input id="ds" name="q" type="search" placeholder={t("placeholder")} defaultValue={q} />
            <button className="btn btn-secondary">{t("searchBtn")}</button>
            {q && <a className="btn btn-ghost" href={L("/my/directory")}>{t("clear")}</a>}
          </form>
          <p className="small muted" role="status">{q ? t("resultsFor", { n: people.length, q }) : t("count", { n: total })}</p>
          {people.length ? (
            <ul className="grid g2 mbr-people">{people.map((p) => (
              <li key={p.id} className="card member-card">
                <div className="avatar teal" aria-hidden="true">{initials(p.name)}</div>
                <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <h2 style={{ fontSize: "1rem", margin: 0 }}>{p.name}{p.id === u.id && <> <span className="badge">{t("you")}</span></>}</h2>
                  {(p.jobTitle || p.organisation) && <p className="small">{[p.jobTitle, p.organisation].filter(Boolean).join(" · ")}</p>}
                </div>
              </li>
            ))}</ul>
          ) : <div className="mbr-empty"><p>{t("noMatch")}</p></div>}
        </>)}
      </main>
    </div>
  );
}
