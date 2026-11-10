// "Return to the requested page after sign-in" (`?next=`) — shared contract between src/lib/session.ts (requireUser/requireAdmin
// add it to the login redirect) and the login/signup pages + actions (they honor it). Pure module: safe in server and client code.
import { locales } from "@/config/site";

/** Longest `next` value accepted (path + query). Longer values are dropped, not truncated. */
export const NEXT_MAX = 200;

/**
 * Validates a `next` value and returns a same-site path for `locale`, or null.
 * Accepted: a path that starts with "/<supported locale>/" (or is exactly "/<locale>"), at most NEXT_MAX chars, with no "//",
 * no backslash, no control/space characters and no "." / ".." segments. Another supported locale's prefix is rewritten to `locale`
 * (the visitor may have switched language on the login page). The auth pages themselves are rejected (no redirect loops).
 * Callers pass the DECODED value (searchParams / FormData already decode it).
 */
export function safeNextPath(v: unknown, locale: string): string | null {
  if (typeof v !== "string" || !v || v.length > NEXT_MAX) return null;
  if (!(locales as readonly string[]).includes(locale)) return null;
  if (v.includes("//") || v.includes("\\") || /[\u0000- \u007f-\u009f]/.test(v)) return null;
  const m = /^\/([a-z]{2})(?=$|[/?#])(.*)$/.exec(v);
  if (!m || !(locales as readonly string[]).includes(m[1])) return null;
  const rest = m[2]; // "" | "/…" | "?…" | "#…"
  const path = rest.split(/[?#]/, 1)[0];
  if (path.split("/").some((seg) => seg === "." || seg === ".." || /^%2e(%2e)?$/i.test(seg) || /%2f|%5c/i.test(seg))) return null;
  if (/^\/(login|signup)(\/|$)/.test(path)) return null;
  return `/${locale}${rest}`;
}

/** `/<locale>/login?next=…` for a requested path (falls back to plain /login when the path isn't a safe target). */
export function loginPath(locale: string, requested?: string | null) {
  const next = safeNextPath(requested, locale);
  return `/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}
