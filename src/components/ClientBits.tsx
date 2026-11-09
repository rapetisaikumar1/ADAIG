"use client";
import { usePathname, useRouter } from "@/i18n/routing";
import { useLocale } from "next-intl";
import { useState } from "react";

export function LangSwitch() {
  const locale = useLocale(); const router = useRouter(); const pathname = usePathname();
  return (
    <div className="lang" role="group" aria-label="Language">
      {(["en", "fr"] as const).map((l) => (
        <button key={l} aria-pressed={locale === l} lang={l} onClick={() => router.replace(pathname, { locale: l })}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

export function NavToggle({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="btn btn-secondary btn-sm nav-toggle" aria-expanded={open} aria-controls="primary-nav"
      onClick={() => { const n = document.getElementById("primary-nav"); setOpen(!!n?.classList.toggle("open")); }}>{label}</button>
  );
}

/** Primary nav with active-section highlighting (QA BUG-020). */
export function PrimaryNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname(); // locale-less, e.g. "/membership"
  return (
    <nav id="primary-nav" className="nav" aria-label="Primary">
      {items.map((i) => {
        const p = i.href.replace(/^\/(en|fr)/, "");
        const active = pathname === p || pathname.startsWith(p + "/") || (p === "/membership" && pathname.startsWith("/join"));
        return <a key={i.href} href={i.href} aria-current={active ? "page" : undefined}>{i.label}</a>;
      })}
    </nav>
  );
}
