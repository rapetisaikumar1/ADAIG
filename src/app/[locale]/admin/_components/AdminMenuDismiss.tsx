"use client";
import { useEffect, useRef } from "react";

/**
 * Closes the mobile "Admin menu" disclosure (<details class="adm-mnav">) the way the site menu closes: on Escape (focus goes back
 * to its summary when it was inside), on a click outside it, and when the site "Menu" button is pressed, so the two panels are
 * never open on top of each other. Renders nothing visible; without JavaScript the disclosure still opens and closes normally.
 */
export function AdminMenuDismiss() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const menu = ref.current?.closest<HTMLDetailsElement>("details.adm-mnav");
    if (!menu) return;
    const close = (refocus: boolean) => {
      if (!menu.open) return;
      const wasInside = menu.contains(document.activeElement);
      menu.open = false;
      if (refocus && wasInside) menu.querySelector<HTMLElement>("summary")?.focus();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && menu.open) close(true); };
    // Capture phase: runs before the site menu's own handlers, which may stop the event.
    const onClick = (e: MouseEvent) => { if (e.target instanceof Node && !menu.contains(e.target)) close(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick, true); };
  }, []);
  return <span ref={ref} hidden />;
}
