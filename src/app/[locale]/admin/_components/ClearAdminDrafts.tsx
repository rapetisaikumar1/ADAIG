"use client";
import { useEffect, useRef } from "react";
import { DRAFT_PREFIX } from "../events/EventFormHelper";

/**
 * Placed inside every sign-out form (AppShell SignOutButton): on submit it removes all admin form drafts (event forms) from this
 * tab's sessionStorage, so nothing typed by one admin can be restored for whoever signs in next in the same tab (FIXLIST D9).
 */
export function ClearAdminDrafts() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const clear = () => {
      try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k?.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(k); } } catch { /* storage unavailable */ }
    };
    form.addEventListener("submit", clear);
    return () => form.removeEventListener("submit", clear);
  }, []);
  return <span ref={ref} hidden />;
}
