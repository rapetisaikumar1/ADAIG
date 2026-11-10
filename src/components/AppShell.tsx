import { getTranslations } from "next-intl/server";
import { signOut } from "@/auth";
import { SidenavScroll } from "./SidenavScroll";

export async function MemberNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("member"); const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  const a = (p: string, label: string) => <a href={L(p)} aria-current={current === p ? "page" : undefined}>{label}</a>;
  return (
    <nav className="sidenav" aria-label="Member navigation">
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
  // Sub-pages (e.g. /admin/members/[id]) keep their section highlighted.
  const a = (p: string, label: string, extra?: React.ReactNode) => <a href={L(p)} aria-current={current === p || current.startsWith(`${p}/`) ? "page" : undefined}>{label}{extra}</a>;
  const preview = <span className="badge nav-tag">{t("preview")}</span>;
  return (
    <nav className="sidenav" aria-label={t("aria")}>
      <h2>{t("staff")}</h2>{a("/admin/dashboard", t("overview"))}
      {a("/admin/members", t("members"), pending > 0 ? <span className="badge badge-amber nav-tag">{pending}<span className="sr-only"> {t("pendingSr")}</span></span> : null)}
      {a("/admin/events", t("events"))}
      {a("/admin/messages", t("messages"), unread > 0 ? <span className="badge badge-amber nav-tag">{unread}<span className="sr-only"> {t("unreadSr")}</span></span> : null)}
      {a("/admin/content", t("content"))}
      <h2>{t("ops")}</h2>{a("/admin/settings", t("settings"))}{a("/admin/audit", t("audit"))}{a("/admin/system", t("system"))}
      <h2>{t("planned")}</h2>{a("/admin/corporate", t("corporate"), preview)}{a("/admin/chapter", t("chapter"), preview)}
      <h2>{t("switch")}</h2>{a("/my/dashboard", t("memberView"))}
      <SignOutButton label={tc("signOut")} locale={locale} />
      <SidenavScroll />
    </nav>
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
