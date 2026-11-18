"use client";
import { useEffect } from "react";

/**
 * Phones/tablets (≤900px): the member sidebar is a horizontally scrolling tab bar with edge fades (member.css). Browsers don't
 * scroll a partly visible element into view when it takes focus, so a keyboard-focused tab could stay half under a fade; this
 * brings it fully into view (nearest edge, honouring the bar's scroll-padding and the tabs' scroll-margin). Renders nothing;
 * does nothing while the bar doesn't scroll (desktop sidebar).
 */
export function TabBarFocus() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".mbr-sidenav");
    if (!nav) return;
    const onFocus = (e: FocusEvent) => {
      if (nav.scrollWidth <= nav.clientWidth || !(e.target instanceof HTMLElement)) return;
      e.target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    nav.addEventListener("focusin", onFocus);
    return () => nav.removeEventListener("focusin", onFocus);
  }, []);
  return null;
}
