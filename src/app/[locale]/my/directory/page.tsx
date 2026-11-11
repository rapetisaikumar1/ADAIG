import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireUser, activeMembership } from "@/lib/session";
import { membershipHousekeeping } from "@/lib/membership";
import { searchParam, likeLiteral } from "@/lib/validation";
import { MemberNav } from "@/components/AppShell";
import type { Locale } from "@/config/site";
import { memberMetadata } from "../_shared/meta";
import { PageHead } from "../_shared/ui";
import { Avatar, EmptyState } from "@/components/ui/Facet";
import { Icon } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("directory");

/**
 * Member directory (live data). Privacy: only users who opted in (Profile & privacy) AND hold an active membership
 * are listed, and only name, job title and organisation are shown. Browsing requires an active membership.
 * Round-7 S4 / SEC L-3: Admin Portal accounts (role admin) are not association members: they get the members-only notice like a
 * guest (no admin bypass), and are never listed; nor are deactivated or deleted accounts.
 */
export default async function Directory({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const t = await getTranslations("member.directoryPage");
  const q = searchParam((await searchParams).q, 80); // control characters (Postgres rejects NUL) → spaces
  const L = (p: string) => `/${locale}${p}`;
  await membershipHousekeeping(u.id); // lazy: a membership past the renewal grace period lapses before access is checked
  const isAdmin = u.role === "admin";
  const canBrowse = !isAdmin && !!(await activeMembership(u.id));
  const pending = canBrowse || isAdmin ? null : await db.membership.findFirst({ where: { userId: u.id, status: "pending_verification" } });
  const ci = { contains: likeLiteral(q), mode: "insensitive" as const }; // case-insensitive, as on SQLite (name uses collation "C": ASCII case folding)
  const listedWhere = { directoryOptIn: true, deletedAt: null, active: true, role: { notIn: ["deleted", "admin"] }, memberships: { some: { status: "active" } } };
  const total = canBrowse ? await db.user.count({ where: listedWhere }) : 0;
  const people = canBrowse ? await db.user.findMany({
    where: { ...listedWhere, ...(q ? { OR: [{ name: ci }, { jobTitle: ci }, { organisation: ci }] } : {}) },
    select: { id: true, name: true, jobTitle: true, organisation: true }, orderBy: { name: "asc" }, take: 200,
  }) : [];
  // The name column sorts in byte order (collation "C"); re-sort for people: accents and lower-case names in alphabetical place.
  const collator = new Intl.Collator(locale === "fr" ? "fr-CA" : "en-CA", { sensitivity: "base" });
  people.sort((a, b) => collator.compare(a.name, b.name));
  return (
    <div className="app"><MemberNav locale={locale} current="/my/directory" />
      <main id="main" tabIndex={-1} className="app-main mbr mbr-directory">
        <PageHead title={t("title")} lead={t("lead")} />
        {!canBrowse ? (
          <EmptyState title={t("membersOnly")} action={!pending && !isAdmin && <a className="btn btn-secondary" href={L("/membership")}>{t("joinLink")}</a>}>{pending ? t("membersOnlyPending") : t("membersOnlyNone")}</EmptyState>
        ) : total === 0 ? (
          // When nobody is listed yet, the empty panel carries the opt-in prompt instead of a separate banner.
          <EmptyState title={t("empty")} action={!u.directoryOptIn && <a className="btn btn-secondary" href={L("/my/profile")}>{t("optIn")}</a>}>{u.directoryOptIn ? t("youListed") : t("emptyBody")}</EmptyState>
        ) : (<>
          <div className="table-toolbar mbr-dir-toolbar">
            <form className="search-bar mbr-search" role="search" method="get" action={L("/my/directory")}>
              <label htmlFor="ds" className="sr-only">{t("search")}</label>
              <input id="ds" name="q" type="search" placeholder={t("placeholder")} defaultValue={q} />
              <button className="btn btn-secondary">{t("searchBtn")}</button>
              {q && <a className="btn btn-ghost" href={L("/my/directory")}>{t("clear")}</a>}
            </form>
            <p className="mbr-dir-count" role="status">{q ? t("resultsFor", { n: people.length, q }) : t("count", { n: total })}</p>
          </div>
          <p className={`mbr-optin${u.directoryOptIn ? " is-listed" : ""}`} role="note">
            <Icon name={u.directoryOptIn ? "check-circle" : "eye"} size={18} />
            <span>{u.directoryOptIn ? t("youListed") : t("youHidden")} <a href={L("/my/profile")}>{t("change")}</a></span>
          </p>
          {people.length ? (
            <ul className="grid g3 mbr-people">{people.map((p) => (
              <li key={p.id} className={`card member-card mbr-person${p.id === u.id ? " is-you" : ""}`}>
                <Avatar name={p.name} tone={p.id === u.id ? "teal" : undefined} />
                <div className="mbr-person-text">
                  <h2>{p.name}{p.id === u.id && <> <span className="badge">{t("you")}</span></>}</h2>
                  {p.jobTitle && <p className="mbr-person-role">{p.jobTitle}</p>}
                  {p.organisation && <p className="mbr-person-org"><Icon name="building" size={14} />{p.organisation}</p>}
                </div>
              </li>
            ))}</ul>
          ) : // The search toolbar above already has "Clear": no second identical action here (QA-PORTALS [17]).
            <EmptyState title={t("noMatch")} />}
        </>)}
      </main>
    </div>
  );
}
