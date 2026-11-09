"use client";
import { usePathname, useRouter } from "@/i18n/routing";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

export function LangSwitch() {
  const locale = useLocale(); const router = useRouter(); const pathname = usePathname();
  return (
    <div className="lang" role="group" aria-label="Language">
      {(["en", "fr"] as const).map((l) => (
        <button type="button" key={l} aria-pressed={locale === l} lang={l} onClick={() => router.replace(pathname + window.location.search + window.location.hash, { locale: l })}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

export function NavToggle({ label, closeLabel }: { label: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const set = (v: boolean) => { document.getElementById("primary-nav")?.classList.toggle("open", v); setOpen(v); };
  useEffect(() => { set(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { set(false); document.querySelector<HTMLButtonElement>(".nav-toggle")?.focus(); } };
    const onClick = (e: MouseEvent) => { const el = e.target as Element; if (!el.closest("#primary-nav, .nav-toggle")) set(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [open]);
  return (
    <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="primary-nav" onClick={() => set(!open)}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 5.5h14M3 10h14M3 14.5h14" />}
      </svg>
      <span>{open ? closeLabel : label}</span>
    </button>
  );
}

/** Primary nav with active-section highlighting (QA BUG-020). Children render only inside the mobile menu panel. */
export function PrimaryNav({ items, children }: { items: { href: string; label: string }[]; children?: React.ReactNode }) {
  const pathname = usePathname(); // locale-less, e.g. "/membership"
  return (
    <nav id="primary-nav" className="nav" aria-label="Primary">
      {items.map((i) => {
        const p = i.href.replace(/^\/(en|fr)/, "");
        const active = pathname === p || pathname.startsWith(p + "/") || (p === "/membership" && pathname.startsWith("/join")) || (p === "/about" && (pathname === "/principles" || pathname === "/governance"));
        return <a key={i.href} href={i.href} aria-current={active ? "page" : undefined}>{i.label}</a>;
      })}
      {children}
    </nav>
  );
}
