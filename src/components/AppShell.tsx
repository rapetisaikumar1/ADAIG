import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { getAdminContext } from "@/lib/rbac";
import { adminHomePath, canPerm } from "@/lib/permissions";
import { SidenavScroll } from "./SidenavScroll";
import { Icon, type IconName } from "./ui/Icon";
import { AdminMenuDismiss } from "@/app/[locale]/admin/_components/AdminMenuDismiss";
import { ConfirmEscape } from "@/app/[locale]/admin/_components/ConfirmEscape";
import { ClearAdminDrafts } from "@/app/[locale]/admin/_components/ClearAdminDrafts";

export async function MemberNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("member"); const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  const a = (p: string, label: string, icon: IconName) => <a href={L(p)} aria-current={current === p ? "page" : undefined}><Icon name={icon} size={18} />{label}</a>;
  return (
    <nav className="sidenav mbr-sidenav" aria-label={t("navAria")}>
      {/* My membership (/my/billing) is the member home; /my/dashboard only redirects there and is not linked. */}
      <h2>{t("account")}</h2>{a("/my/billing", t("billing"), "card")}{a("/my/profile", t("profile"), "user")}
      <h2>{t("participate")}</h2>{a("/my/events", t("events"), "calendar")}{a("/my/community", t("community"), "users")}{a("/my/directory", t("directory"), "book")}
      <SignOutButton label={tc("signOut")} locale={locale} />
      <SidenavScroll />
    </nav>
  );
}

export async function AdminNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("adminNav"); const tc = await getTranslations("chrome");
  const { db } = await import("@/lib/db"); // imported here so only the admin shell touches the DB
  // The signed-in admin's effective permissions (round 7, SPEC_R7 §5.5; memoized per request, re-read from the DB): the menu lists
  // only the modules the role can view, and each badge is counted only when its module is listed.
  const perms = (await getAdminContext())?.permissions;
  const sees = (m: "members" | "events" | "messages" | "users" | "roles") => canPerm(perms, m, "view");
  const [pending, unread] = await Promise.all([
    sees("members") ? db.membership.count({ where: { status: "pending_verification", user: { role: { notIn: ["deleted", "admin"] } } } }) : 0,
    sees("messages") ? db.contactMessage.count({ where: { status: "new" } }) : 0,
  ]);
  const L = (p: string) => `/${locale}${p}`;
  const isCurrent = (p: string) => current === p || current.startsWith(`${p}/`); // sub-pages (e.g. /admin/members/[id]) keep their section highlighted
  const badge = (n: number, sr: string) => n > 0 ? <span className="badge badge-amber nav-tag">{n}<span className="sr-only"> {sr}</span></span> : null; // sr text is an ICU plural of n
  // D8 order: Members, Events, Messages, Users, Roles — each only with view permission. Overview (/admin/dashboard), Settings, Audit
  // log, System and the planned-tool previews are not linked from the menu but stay reachable by URL (system.view); on those pages
  // no menu item is highlighted.
  type Item = [string, string, IconName, React.ReactNode?];
  const links: Item[] = [
    ...(sees("members") ? [["/admin/members", t("members"), "users", badge(pending, t("pendingSr", { n: pending }))] as Item] : []),
    ...(sees("events") ? [["/admin/events", t("events"), "calendar"] as Item] : []),
    ...(sees("messages") ? [["/admin/messages", t("messages"), "inbox", badge(unread, t("unreadSr", { n: unread }))] as Item] : []),
    ...(sees("users") ? [["/admin/users", t("users"), "id-badge"] as Item] : []),
    ...(sees("roles") ? [["/admin/roles", t("roles"), "key"] as Item] : []),
  ];
  const groups: { title: string; links: Item[] }[] = [{ title: t("staff"), links }];
  const a = ([p, label, icon, extra]: Item) => <a key={p} href={L(p)} aria-current={isCurrent(p) ? "page" : undefined}><Icon name={icon} size={18} />{label}{extra}</a>;
  // A role without any viewable module (§4.9): a calm note in place of the links; the profile menu stays.
  const groupLinks = (g: { links: Item[] }) => g.links.length ? g.links.map(a) : <p className="adm-nav-empty">{t("noTools")}</p>;
  const here = links.find(([p]) => isCurrent(p))?.[1];
  const waiting = pending + unread;
  const me = await adminIdentity();
  return (
    <>
      {/* Desktop (≥901px): a fixed app sidebar from under the admin header to the bottom of the window — navigation on top, the
          admin's profile menu pinned to the very bottom. The profile sits outside the <nav>: it is the account menu, not admin
          navigation. */}
      <div className="adm-side">
        <nav className="sidenav adm-sidenav" aria-label={t("aria")}>
          {groups.map((g) => <div key={g.title} className="adm-nav-group"><h2>{g.title}</h2>{groupLinks(g)}</div>)}
          {/* No separate Sign out here (client request): it lives in the profile menu at the bottom of the sidebar. */}
        </nav>
        <div className="adm-side-foot">
          <details className="adm-profile">
            {/* avatar · name (bold) over the e-mail (muted), each truncated with an ellipsis (full name and e-mail in the name's tooltip); the chevron is the summary's ::after */}
            <summary>
              <span className="sr-only">{t("accountMenu")}: </span>
              <span className="avatar" aria-hidden="true">{me.initials}</span>
              <span className="adm-profile-id">
                <span className="adm-profile-name" title={[me.name, me.email].filter(Boolean).join(" · ")}>{me.name}</span>
                {me.email && <>{" "}<span className="adm-profile-email" title={me.email}>{me.email}</span></>}
              </span>
            </summary>
            <div className="adm-profile-menu">
              <a href={L("/my/profile")}><Icon name="user" size={18} />{t("profile")}</a>
              <SignOutButton label={tc("signOut")} locale={locale} />
            </div>
            <AdminMenuDismiss />
          </details>
        </div>
      </div>
      {/* Phones and tablets (≤900px): one "Admin menu" disclosure with the same links (the admin header has no other menu). The nav
          wraps the whole disclosure so its summary is inside the landmark (QA-FA-17); only one of the two navs shows at a time. */}
      <nav className="adm-mnav-wrap" aria-label={t("aria")}>
      <details className="adm-mnav">
        <summary><Icon name="menu" size={20} /><span className="adm-mnav-label"><span className="adm-mnav-long">{t("menu")}</span><span className="adm-mnav-short" aria-hidden="true">{tc("menu")}</span></span>{here && <span className="adm-mnav-here"> · {here}</span>}{waiting > 0 && <span className="badge badge-amber nav-tag">{waiting}<span className="sr-only"> {t("waitingSr", { n: waiting })}</span></span>}</summary>
        <div className="adm-mnav-links">
          {groups.map((g) => <div key={g.title} className="adm-mnav-group"><h2>{g.title}</h2>{groupLinks(g)}</div>)}
        </div>
        {/* Phones/tablets: the same profile at the bottom of the menu panel — avatar and name, Profile & privacy, then Sign out last. */}
        <div className="adm-mnav-profile">
          <span className="adm-mnav-me"><span className="avatar" aria-hidden="true">{me.initials}</span><span className="adm-profile-name">{me.name}</span></span>
          <a href={L("/my/profile")}><Icon name="user" size={18} />{t("profile")}</a>
          <SignOutButton label={tc("signOut")} locale={locale} />
        </div>
        <AdminMenuDismiss />
      </details>
      </nav>
      <ConfirmEscape />
    </>
  );
}

/** The signed-in admin's display name, initials and e-mail (for the profile menu in the admin sidebar; the e-mail may be empty). */
async function adminIdentity() {
  const s = await auth();
  const name = s?.user?.name ?? "";
  const email = s?.user?.email ?? "";
  return { name, email, initials: name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase() };
}

/**
 * Admin portal header (/admin/* only, chosen in the [locale] layout via AreaChrome): the logo, linking to the admin's home
 * (adminHomePath: the first module their role can view), and the "Admin" tag. The admin's profile menu (avatar + name → Profile & privacy, Sign out) lives at the bottom of
 * the admin sidebar (AdminNav). No public navigation, utility links, language switch or "Admin" button. The layout renders it only
 * for signed-in admins; every admin page still runs its permission guard (src/lib/rbac.ts).
 */
export async function AdminHeader({ locale }: { locale: string }) {
  const t = await getTranslations("adminNav"); const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  const home = adminHomePath((await getAdminContext())?.permissions); // first module the role can view, else /admin/no-access
  return (
    <>
      <a className="skip" href="#main">{tc("skip")}</a>
      <header className="admin-header"><div className="admin-header__inner">
        <a className="brand admin-header__brand" href={L(home)} aria-label={t("homeAria")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image adds nothing for SVG */}
          <img src="/assets/logo.svg" alt="" width={220} height={52} />
          <span className="admin-header__tag" aria-hidden="true">{tc("admin")}</span>
        </a>
      </div></header>
    </>
  );
}

/** Slim admin footer line (the public footer is not shown in the admin portal). */
export async function AdminFooter() {
  const t = await getTranslations("footer");
  return <footer className="admin-footer"><div className="admin-footer__inner"><span>{t("copy")}</span></div></footer>;
}

/** Styled like a sidenav link (same padding and left edge), separated from the links above by a rule. */
function SignOutButton({ label, locale }: { label: string; locale: string }) {
  return (
    <form className="sidenav-signout" action={async () => { "use server"; await signOut({ redirectTo: `/${locale}` }); }}>
      <button type="submit">
        <Icon name="log-out" size={18} />
        {label}
      </button>
      <ClearAdminDrafts />
    </form>
  );
}
