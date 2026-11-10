import { getTranslations } from "next-intl/server";
import { signOut } from "@/auth";
import { SidenavScroll } from "./SidenavScroll";
import { AdminMenuDismiss } from "@/app/[locale]/admin/_components/AdminMenuDismiss";

export async function MemberNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("member"); const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  const a = (p: string, label: string) => <a href={L(p)} aria-current={current === p ? "page" : undefined}>{label}</a>;
  return (
    <nav className="sidenav" aria-label={t("navAria")}>
      <h2>{t("account")}</h2>{a("/my/dashboard", t("dashboard"))}{a("/my/billing", t("billing"))}{a("/my/profile", t("profile"))}
      <h2>{t("participate")}</h2>{a("/my/events", t("events"))}{a("/my/community", t("community"))}{a("/my/directory", t("directory"))}
      {/* Public site section, not part of the member area: flagged with ↗ */}
      <a href={L("/resources")} className="sidenav-out">{t("library")}<span className="sidenav-ext" aria-hidden="true">↗</span><span className="sr-only"> {t("publicSite")}</span></a>
      <SignOutButton label={tc("signOut")} locale={locale} />
      <SidenavScroll />
    </nav>
  );
}

export async function AdminNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("adminNav"); const tc = await getTranslations("chrome");
  const { db } = await import("@/lib/db"); // imported here so only the admin shell touches the DB
  const [pending, unread] = await Promise.all([
    db.membership.count({ where: { status: "pending_verification", user: { role: { not: "deleted" } } } }),
    db.contactMessage.count({ where: { status: "new" } }),
  ]);
  const L = (p: string) => `/${locale}${p}`;
  const isCurrent = (p: string) => current === p || current.startsWith(`${p}/`); // sub-pages (e.g. /admin/members/[id]) keep their section highlighted
  const badge = (n: number, sr: string) => n > 0 ? <span className="badge badge-amber nav-tag">{n}<span className="sr-only"> {sr}</span></span> : null;
  // Planned tools (enterprise seats, chapter leaders) are previews only: linked from the Overview page, not from the menu.
  const groups: { title: string; links: [string, string, React.ReactNode?][] }[] = [
    { title: t("staff"), links: [["/admin/dashboard", t("overview")], ["/admin/members", t("members"), badge(pending, t("pendingSr"))], ["/admin/events", t("events")], ["/admin/messages", t("messages"), badge(unread, t("unreadSr"))], ["/admin/content", t("content")]] },
    { title: t("ops"), links: [["/admin/settings", t("settings")], ["/admin/audit", t("audit")], ["/admin/system", t("system")]] },
    { title: t("switch"), links: [["/my/dashboard", t("memberView")]] },
  ];
  const a = ([p, label, extra]: [string, string, React.ReactNode?]) => <a key={p} href={L(p)} aria-current={isCurrent(p) ? "page" : undefined}>{label}{extra}</a>;
  const here = groups.flatMap((g) => g.links).find(([p]) => isCurrent(p))?.[1];
  const waiting = pending + unread;
  return (
    <>
      {/* Desktop: sidebar with group headings. */}
      <nav className="sidenav adm-sidenav" aria-label={t("aria")}>
        {groups.map((g) => <div key={g.title} className="adm-nav-group"><h2>{g.title}</h2>{g.links.map(a)}</div>)}
        <SignOutButton label={tc("signOut")} locale={locale} />
      </nav>
      {/* Phones and tablets (≤900px): one "Admin menu" disclosure with the same groups, instead of a long sideways strip. */}
      <details className="adm-mnav">
        <summary><span className="adm-mnav-label">{t("menu")}</span>{here && <span className="adm-mnav-here"> · {here}</span>}{waiting > 0 && <span className="badge badge-amber nav-tag">{waiting}<span className="sr-only"> {t("waitingSr")}</span></span>}</summary>
        <nav aria-label={t("aria")}>
          {groups.map((g) => <div key={g.title} className="adm-mnav-group"><h2>{g.title}</h2>{g.links.map(a)}</div>)}
          <SignOutButton label={tc("signOut")} locale={locale} />
        </nav>
        <AdminMenuDismiss />
      </details>
    </>
  );
}

/** Styled like a sidenav link (same padding and left edge), separated from the links above by a rule. */
function SignOutButton({ label, locale }: { label: string; locale: string }) {
  return (
    <form className="sidenav-signout" action={async () => { "use server"; await signOut({ redirectTo: `/${locale}` }); }}>
      <button type="submit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
        {label}
      </button>
    </form>
  );
}
