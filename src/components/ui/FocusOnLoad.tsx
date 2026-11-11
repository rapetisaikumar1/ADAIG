"use client";
import { useEffect, useRef } from "react";

/**
 * Wraps a confirmation or error notice that is rendered after a server-action redirect (e.g. ?saved=1, ?applied=1). A notice
 * that is already in the page on load is not announced by screen readers, so this moves focus to it once (tabIndex -1, so it is
 * not a tab stop) and scrolls it into view — keyboard and screen-reader users land on the outcome of what they just did (FA-5).
 * Render it only when the notice is the result of the user's own action, never for standing notices.
 * (The flash query parameter stays in the URL — post/redirect/get; the language switch drops it, see ClientBits LangSwitch.)
 */
export function FocusOnLoad({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: false }); }, []);
  return <div ref={ref} tabIndex={-1} className={["focus-on-load", className].filter(Boolean).join(" ")}>{children}</div>;
}
