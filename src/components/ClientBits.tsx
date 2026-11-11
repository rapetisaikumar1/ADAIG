"use client";
import { usePathname, useRouter } from "@/i18n/routing";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

const LANG_NAMES = { en: "English", fr: "Français" } as const;
/** One-shot action-result params (post/redirect/get flashes). They stay in the URL for the page that shows the notice, but the
 *  language switch drops them so the notice is not replayed in the other language (coordinator decision D8). */
const FLASH_PARAMS = ["saved", "applied", "already", "welcome", "msg", "registered", "error", "pw", "del", "long", "deleted", "sent"];
const searchWithoutFlash = (search: string) => {
  const q = new URLSearchParams(search);
  for (const k of FLASH_PARAMS) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** EN/FR switch — NOT rendered since round 6b (client: French is no longer offered; translations and /fr routes are kept for
 *  future use). Kept so the switch can be re-enabled in SiteChrome (utility bar + menu panel) without rewriting it.
 *  A labelled <nav> landmark (A1-10); `group` renders it as a labelled group instead, for the copy inside the
 *  primary-nav menu panel, so there is one "Language" landmark and no nav nested in a nav (QA-FA-16). Each button's accessible
 *  name starts with its visible text and adds the language's own name ("EN – English", "FR – Français"), so speech users can say
 *  what they see (WCAG 2.5.3, QA FA-4). */
export function LangSwitch({ label, group = false }: { label: string; group?: boolean }) {
  const locale = useLocale(); const router = useRouter(); const pathname = usePathname();
  const Tag = group ? "div" : "nav";
  return (
    <Tag className="lang" role={group ? "group" : undefined} aria-label={label}>
      {(["en", "fr"] as const).map((l) => (
        <button type="button" key={l} aria-pressed={locale === l} onClick={() => router.replace(pathname + searchWithoutFlash(window.location.search) + window.location.hash, { locale: l })}>
          {l.toUpperCase()}<span className="sr-only"> – <span lang={l}>{LANG_NAMES[l]}</span></span>
        </button>
      ))}
    </Tag>
  );
}

/** Section of the site a locale-less path belongs to, for aria-current on header links (QA BUG-020, V2-11). */
function isActive(p: string, pathname: string) {
  return pathname === p || pathname.startsWith(p + "/")
    || (p === "/membership" && (pathname.startsWith("/join") || pathname === "/vendors"))
    || (p === "/about" && pathname === "/principles") // /governance has its own item ("Advisory Board")
    || (p === "/community" && pathname === "/chapters");
}

type Item = { href: string; label: string };

/** True for the admin portal (locale-less path /admin or /admin/…). */
export const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");

/**
 * Picks the chrome for the current area: the admin portal (/admin/*) gets `admin` (its own minimal header/footer), every other
 * page gets `site` (the public header/footer). Chosen from the client pathname, not on the server, so it stays right after
 * client-side navigations (server-action redirects, e.g. sign-in → /admin/members) where the root layout is not re-rendered.
 * `admin` is only rendered by the layout for signed-in admins (null otherwise → the public chrome, as before).
 */
export function AreaChrome({ admin, site }: { admin: React.ReactNode; site: React.ReactNode }) {
  const pathname = usePathname();
  return <>{admin && (isAdminPath(pathname) || pathname === "/my/profile") ? admin : site}</>; // admins edit their profile inside the admin portal
}

/** Utility links (Chapters, Careers, Contact): rendered in the top bar and again inside the mobile menu panel (V3-1). */
export function UtilLinks({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return <>{items.map((i) => <a key={i.href} href={i.href} aria-current={pathname === i.href.replace(/^\/(en|fr)/, "") ? "page" : undefined}>{i.label}</a>)}</>;
}

/**
 * Header navigation: the menu toggle followed by the primary nav panel, in that DOM order, so keyboard and screen-reader order
 * is "Menu" → panel links (A1-2). On ≤1240px the panel is a disclosure (`.nav.open`; the scrim and the page scroll lock are CSS in
 * chrome.css). Opening moves focus to the first link (focus calls use preventScroll so the page never jumps, R2-1); Escape, a click outside, moving focus out of the header or navigating closes it.
 * `children` render only inside the mobile panel (account buttons, utility links).
 */
export function HeaderNav({ items, label, menuLabel, closeLabel, children }: { items: Item[]; label: string; menuLabel: string; closeLabel: string; children?: React.ReactNode }) {
  const pathname = usePathname(); // locale-less, e.g. "/membership"
  const [open, setOpen] = useState(false);
  // Close the menu on navigation (state adjusted during render instead of in an effect).
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) { setShownPath(pathname); setOpen(false); }
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const focusFirst = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) { focusFirst.current = false; navRef.current?.querySelector<HTMLElement>("a[href], button")?.focus({ preventScroll: true }); }
    const inMenu = (el: EventTarget | null) => el instanceof Node && !!(navRef.current?.contains(el) || toggleRef.current?.contains(el));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggleRef.current?.focus({ preventScroll: true }); } };
    // Outside click closes. Clicks on the dimmed page (outside the header bars) are swallowed so they don't also follow a link
    // or press a button hidden under the scrim.
    const onClick = (e: MouseEvent) => {
      if (inMenu(e.target)) return;
      setOpen(false);
      if (!(e.target instanceof Element && e.target.closest(".site-header, .util"))) { e.preventDefault(); e.stopPropagation(); }
    };
    const onFocus = (e: FocusEvent) => { if (!inMenu(e.target)) setOpen(false); };
    // The panel only exists below 1241px (chrome.css header breakpoint): if the viewport grows past it, drop the open state (and with it the scroll lock).
    const mq = window.matchMedia("(min-width: 1241px)");
    const onMq = () => { if (mq.matches) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("click", onClick, true); document.addEventListener("focusin", onFocus);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick, true); document.removeEventListener("focusin", onFocus);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  return (
    <>
      <button ref={toggleRef} type="button" className="nav-toggle" aria-expanded={open} aria-controls="primary-nav"
        onClick={() => { focusFirst.current = !open; setOpen(!open); }}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 5.5h14M3 10h14M3 14.5h14" />}
        </svg>
        <span>{open ? closeLabel : menuLabel}</span>
      </button>
      <nav ref={navRef} id="primary-nav" className={open ? "nav open" : "nav"} aria-label={label}>
        {items.map((i) => {
          const p = i.href.replace(/^\/(en|fr)/, "");
          return <a key={i.href} href={i.href} aria-current={isActive(p, pathname) ? "page" : undefined}>{i.label}</a>;
        })}
        {children}
      </nav>
    </>
  );
}
