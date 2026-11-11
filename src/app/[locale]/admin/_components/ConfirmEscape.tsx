"use client";
import { useEffect } from "react";

/**
 * Escape closes an open inline confirm (details.confirm / details.adm-confirm) and returns focus to its summary, like the admin
 * menus do (QA-FA-9). The confirm that holds focus closes first; otherwise the one opened last. Rendered once by AdminNav, so it
 * covers every admin page. Without JavaScript the confirms still open and close with their summary.
 */
export function ConfirmEscape() {
  useEffect(() => {
    let last: HTMLDetailsElement | null = null;
    const onToggle = (e: Event) => { const d = e.target; if (d instanceof HTMLDetailsElement && d.matches(".confirm, .adm-confirm") && d.open) last = d; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      const holder = active?.closest<HTMLDetailsElement>("details.confirm[open], details.adm-confirm[open]") ?? (last?.open ? last : null);
      if (!holder) return;
      holder.open = false;
      holder.querySelector<HTMLElement>(":scope > summary")?.focus();
      e.stopPropagation();
    };
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("toggle", onToggle, true); document.removeEventListener("keydown", onKey); };
  }, []);
  return null;
}
