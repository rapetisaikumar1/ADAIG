import { countries, subdivisionsFor, locales, defaultLocale } from "@/config/site";
/** Locale from a form field, whitelisted (replayed/forged posts can't build odd redirect paths). */
export const safeLocale = (v: unknown) => ((locales as readonly string[]).includes(String(v)) ? String(v) : defaultLocale);
/** Server-side input rules (QA BUG-035/036/037). Limits live here so they are easy to change. */
export const limits = { email: 254, name: 100, organisation: 150, jobTitle: 100, institution: 150, reason: 500, passwordMin: 12, passwordMax: 128 };

/** Small blocklist of very common passwords (lower-cased, compared after trimming). Extend or swap for a breached-password check later. */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "password12345", "passw0rd", "p@ssw0rd", "p@ssword123",
  "123456789012", "1234567890123", "123456123456", "111111111111", "000000000000", "qwertyuiop", "qwertyuiop12", "qwerty123456",
  "1q2w3e4r5t6y", "iloveyou1234", "letmein12345", "welcome12345", "welcome123", "admin1234567", "administrator", "changeme1234",
  "abc123456789", "aaaaaaaaaaaa", "football1234", "baseball1234", "sunshine1234", "princess1234", "monkey123456", "dragon123456",
  "trustno1trustno1", "adaig1234567", "adaigpassword", "password123!", "password1234!", "qwerty123456!", "welcome2026!",
]);
export type PwError = "short" | "long" | "blank" | "common";
export function checkPassword(pw: string, email?: string): PwError | null {
  if (!pw.trim()) return "blank";
  if ([...pw].length < limits.passwordMin) return "short";
  if ([...pw].length > limits.passwordMax) return "long";
  const low = pw.trim().toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(low) || (email && low === email.toLowerCase())) return "common";
  return null;
}
const EMAIL = /^[^\s@"<>(),;:\\[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const emailOk = (e: string) => e.length <= limits.email && EMAIL.test(e) && !/\.\./.test(e);
/** Collapse whitespace, strip control chars; null if empty or over the limit. */
export function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s && [...s].length <= max ? s : null;
}
/** Whitelist + normalise country (case/space-insensitive) → canonical value or null. */
export function normCountry(v: unknown): string | null {
  const k = String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return countries.find((c) => c.toLowerCase() === k) ?? null;
}
/** State/province code for countries that have a list (US: states+DC+territories, Canada: provinces); null if invalid. */
export function normProvince(v: unknown, country = "Canada"): string | null {
  const k = String(v ?? "").trim().toUpperCase();
  return subdivisionsFor(country)?.some((p) => p.code === k) ? k : null;
}
/** True when the text contains C0/DEL control characters (Postgres rejects NUL; none belong in ids, slugs, emails). */
export const hasCtl = (v: string) => /[\u0000-\u001f\u007f]/.test(v);
/** Audit-log targets built from untrusted input are capped (no unbounded rows from anonymous requests). */
export const AUDIT_TARGET_MAX = 300;
export const auditTarget = (v: string) => (v.length > AUDIT_TARGET_MAX ? v.slice(0, AUDIT_TARGET_MAX) : v);
/**
 * One query-string / route / form value: the first value of a repeated parameter, as a string. Ids and slugs with control
 * characters or over `max` become "" (matches nothing, so callers take their existing "not found" path).
 */
export function idParam(v: unknown, max = 64): string {
  const s = String((Array.isArray(v) ? v[0] : v) ?? "");
  return s.length > max || hasCtl(s) ? "" : s;
}
/** Free-text search from the query string: first value, control characters → spaces, trimmed, capped. */
export function searchParam(v: unknown, max: number): string {
  return String((Array.isArray(v) ? v[0] : v) ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
export const isUniqueViolation =(e: unknown) => (e as { code?: string })?.code === "P2002";
/** Escape LIKE/ILIKE wildcards so user search text matches literally (Prisma `contains` does not escape % and _ on Postgres). */
export const likeLiteral = (s: string) => s.replace(/[\\%_]/g, "\\$&");
