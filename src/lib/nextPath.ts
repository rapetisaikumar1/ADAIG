// "Return to the requested page after sign-in" (`?next=`) — shared contract between src/lib/session.ts requireUser and
// src/lib/rbac.ts requireAdminContext (they add it to the login redirect) and the login/signup pages + actions (they honor it). Pure module: safe in server and client code.
import { locales } from "@/config/site";
import { localeHref } from "@/lib/localePath";

/** Longest `next` value accepted (path + query). Longer values are dropped, not truncated. */
export const NEXT_MAX = 200;

/**
 * Validates a `next` value and returns a same-site PUBLIC path for `locale` (English has no prefix: "/admin/members"), or null.
 * Accepted: a site path, with or without a supported locale prefix ("/admin/x", "/en/admin/x", "/fr/admin/x", "/en"), at most
 * NEXT_MAX chars, with no "//", no backslash, no control/space characters and no "." / ".." segments. A locale prefix is replaced
 * by `locale`'s (the visitor may have switched language on the login page). The auth pages themselves are rejected (no redirect
 * loops). Callers pass the DECODED value (searchParams / FormData already decode it).
 */
export function safeNextPath(v: unknown, locale: string): string | null {
  if (typeof v !== "string" || !v || v.length > NEXT_MAX) return null;
  if (!(locales as readonly string[]).includes(locale)) return null;
  if (!v.startsWith("/") || v.includes("//") || v.includes("\\") || /[\u0000- \u007f-\u009f]/.test(v)) return null;
  const m = /^\/([a-z]{2})(?=$|[/?#])(.*)$/.exec(v);
  const rest = m && (locales as readonly string[]).includes(m[1]) ? m[2] : v; // "" | "/…" | "?…" | "#…"
  const path = rest.split(/[?#]/, 1)[0];
  if (path.split("/").some((seg) => seg === "." || seg === ".." || /^%2e(%2e)?$/i.test(seg) || /%2f|%5c/i.test(seg))) return null;
  if (/^\/(login|signup)(\/|$)/.test(path)) return null;
  return localeHref(locale, rest);
}

/** The login page for a requested path, e.g. `/login?next=%2Fadmin%2Fmembers` (plain /login when the path isn't a safe target). */
export function loginPath(locale: string, requested?: string | null) {
  const next = safeNextPath(requested, locale);
  return `${localeHref(locale, "/login")}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}
