"use client";
import { useEffect } from "react";

/**
 * Swaps a search input's placeholder for a shorter one on phones (≤640px), so it is never cut off ("Search members" instead of
 * "Search name, email, organization"). The long placeholder is server-rendered; without JavaScript it simply stays.
 */
export function PhonePlaceholder({ inputId, short }: { inputId: string; short: string }) {
  useEffect(() => {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;
    const long = input.placeholder;
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => { input.placeholder = mq.matches ? short : long; };
    apply();
    mq.addEventListener("change", apply);
    return () => { mq.removeEventListener("change", apply); input.placeholder = long; };
  }, [inputId, short]);
  return null;
}
