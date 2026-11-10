"use client";
import { usePathname, useRouter } from "@/i18n/routing";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

const LANG_NAMES = { en: "English", fr: "Français" } as const;

/** EN/FR switch. A labelled <nav> landmark (A1-10); each button is named in its own language and keeps the visible "EN"/"FR". */
export function LangSwitch({ label }: { label: string }) {
  const locale = useLocale(); const router = useRouter(); const pathname = usePathname();
  return (
    <nav className="lang" aria-label={label}>
      {(["en", "fr"] as const).map((l) => (
        <button type="button" key={l} aria-pressed={locale === l} lang={l} aria-label={LANG_NAMES[l]} onClick={() => router.replace(pathname + window.location.search + window.location.hash, { locale: l })}>{l.toUpperCase()}</button>
      ))}
    </nav>
  );
}

/** Section of the site a locale-less path belongs to, for aria-current on header links (QA BUG-020, V2-11). */
function isActive(p: string, pathname: string) {
  return pathname === p || pathname.startsWith(p + "/")
    || (p === "/membership" && (pathname.startsWith("/join") || pathname === "/vendors"))
    || (p === "/about" && (pathname === "/principles" || pathname === "/governance"))
    || (p === "/community" && pathname === "/chapters");
}

type Item = { href: string; label: string };

/** Utility links (Chapters, Careers, Contact): rendered in the top bar and again inside the mobile menu panel (V3-1). */
export function UtilLinks({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return <>{items.map((i) => <a key={i.href} href={i.href} aria-current={pathname === i.href.replace(/^\/(en|fr)/, "") ? "page" : undefined}>{i.label}</a>)}</>;
}

/**
 * Header navigation: the menu toggle followed by the primary nav panel, in that DOM order, so keyboard and screen-reader order
 * is "Menu" → panel links (A1-2). On ≤1240px the panel is a disclosure (`.nav.open`; the scrim and the page scroll lock are CSS in
 * site.css). Opening moves focus to the first link (focus calls use preventScroll so the page never jumps, R2-1); Escape, a click outside, moving focus out of the header or navigating closes it.
 * `children` render only inside the mobile panel (account buttons, utility links, language switch).
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
    // The panel only exists below 1241px: if the viewport grows past it, drop the open state (and with it the scroll lock).
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
