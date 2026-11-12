import { emailOk, normEmail } from "../validation";
/**
 * Email settings, read from the environment on every call (cheap; nothing cached here, the transport caches itself).
 * No secrets leave this module: emailConfig() reports whether SMTP auth is set, never the user name or the password.
 *
 *   SMTP_HOST            unset/empty → email is "not configured": sendEmail() logs status "skipped" and the app carries on (E4)
 *   SMTP_PORT            default 465
 *   SMTP_SECURE          "true"/"false"; default true when the port is 465 (implicit TLS), else STARTTLS
 *   SMTP_USER / SMTP_PASSWORD   optional (local Mailpit needs none); both or neither
 *   CONTACT_FROM_EMAIL   From header, "Name <address>" or a bare address (falls back to SMTP_USER when that is an address)
 *   CONTACT_TO_EMAIL     the association inbox (contact form and join notifications)
 *   NEXT_PUBLIC_SITE_URL absolute links and the hosted logo (fallback APP_URL, then http://localhost:3000)
 * Shared by the app (src/lib/email/send.ts) and scripts/send-test-email.mjs, so: no "@/" imports, no database.
 */
export const ASSOCIATION_NAME = "Association for Data and AI Governance";
export const ASSOCIATION_SHORT = "ADAIG";

const env = (k: string) => process.env[k]?.trim() || undefined;
/** Remove CR, LF and other control characters (header injection), collapse spaces. */
export const headerSafe = (v: string, max = 200) => v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export type Mailbox = { name: string; address: string };
/** Parse "Name <addr>", "\"Name\" <addr>" or "addr" → a validated mailbox (address lower-cased), else null. */
export function parseMailbox(raw: string | undefined): Mailbox | null {
  if (!raw) return null;
  const v = headerSafe(raw, 400);
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(v);
  const address = normEmail(m ? m[2] : v);
  if (!emailOk(address)) return null;
  const name = m ? headerSafe(m[1].replace(/^"(.*)"$/, "$1").replace(/["\\]/g, ""), 100) : "";
  return { name, address };
}

/** A recipient / Reply-To address: trimmed, lower-cased, validated with the app's email rule. null when invalid. */
export function cleanAddress(raw: unknown): string | null {
  const a = normEmail(raw);
  return a && !/[\u0000-\u001f\u007f]/.test(a) && emailOk(a) ? a : null;
}

/**
 * Replace every email address in a text with "[address]" (round-8 SEC L4): SMTP replies quote the recipient
 * ("550 5.1.1 <name@domain>: Recipient address rejected"), and that text goes to EmailLog.error and the server logs.
 * ADDRESS_IN_TEXT_SQL is the same pattern for Postgres regexp_replace(…, 'g') (scrubbing stored rows on account deletion).
 */
const ADDRESS_IN_TEXT = /[^\s<>()"'\[\],;:]+@[^\s<>()"'\[\],;:]*/g;
export const ADDRESS_IN_TEXT_SQL = `[^\\s<>()"'\\[\\],;:]+@[^\\s<>()"'\\[\\],;:]*`;
export const redactAddresses = (text: string) => text.replace(ADDRESS_IN_TEXT, "[address]");

const flag = (v: string | undefined) => (v === undefined ? undefined : /^(1|true|yes|on)$/i.test(v) ? true : /^(0|false|no|off)$/i.test(v) ? false : undefined);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const isLocalHost = (h: string) => LOCAL_HOSTS.has(h.toLowerCase());

export type SmtpSettings = {
  host: string; port: number; secure: boolean; requireTLS: boolean;
  auth?: { user: string; pass: string };
  from: Mailbox;
};
/** Full SMTP settings (includes the password: for the transport only). null when not configured; `problem` says why if misconfigured. */
export function smtpSettings(): { settings: SmtpSettings | null; problem?: string } {
  const host = env("SMTP_HOST");
  if (!host) return { settings: null };
  const portRaw = env("SMTP_PORT");
  const port = portRaw ? Number(portRaw) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { settings: null, problem: "SMTP_PORT is not a valid port number" };
  const secure = flag(env("SMTP_SECURE")) ?? port === 465;
  const user = env("SMTP_USER"), pass = process.env.SMTP_PASSWORD || undefined; // the password is used as-is (may contain spaces)
  if (!!user !== !!pass) return { settings: null, problem: "set both SMTP_USER and SMTP_PASSWORD, or neither" };
  const from = parseMailbox(env("CONTACT_FROM_EMAIL")) ?? (user && cleanAddress(user) ? { name: ASSOCIATION_SHORT, address: cleanAddress(user)! } : null);
  if (!from) return { settings: null, problem: "CONTACT_FROM_EMAIL is missing or not a valid address" };
  // Never send credentials in clear text to a remote server: without implicit TLS, STARTTLS is required except on localhost (Mailpit).
  return { settings: { host, port, secure, requireTLS: !secure && !isLocalHost(host), auth: user && pass ? { user, pass } : undefined, from } };
}

/** The association inbox (CONTACT_TO_EMAIL) as a bare address, or null when unset/invalid (then skip staff notifications). */
export function contactInbox(): string | null {
  return parseMailbox(env("CONTACT_TO_EMAIL"))?.address ?? null;
}

/**
 * Absolute URL on the public site: NEXT_PUBLIC_SITE_URL → APP_URL → http://localhost:3000. Pass the path with its locale ("/en/…").
 * In production (NODE_ENV=production) links are always https: an http origin is upgraded unless its host is localhost
 * (round-8 SEC M2: reset tokens never travel in clear text). scripts/check-env.mjs also fails the build when
 * NEXT_PUBLIC_SITE_URL is not https or its host differs from APP_URL's.
 */
export function siteUrl(path = ""): string {
  let base = "http://localhost:3000";
  for (const v of [env("NEXT_PUBLIC_SITE_URL"), env("APP_URL")]) {
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.protocol === "https:" || u.protocol === "http:") {
        if (u.protocol === "http:" && process.env.NODE_ENV === "production" && !isLocalHost(u.hostname)) u.protocol = "https:";
        base = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
        break;
      }
    } catch { /* try the next one */ }
  }
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export type EmailConfig = {
  configured: boolean; problem?: string;
  host?: string; port?: number; secure?: boolean; auth: boolean;
  from?: string; contactTo: string | null; siteUrl: string;
};
/** Configuration state for status screens and scripts. No secrets (no user name, no password). */
export function emailConfig(): EmailConfig {
  const { settings: s, problem } = smtpSettings();
  return {
    configured: !!s, ...(problem ? { problem } : {}),
    host: s?.host ?? env("SMTP_HOST"), port: s?.port, secure: s?.secure, auth: !!s?.auth,
    from: s ? (s.from.name ? `${s.from.name} <${s.from.address}>` : s.from.address) : undefined,
    contactTo: contactInbox(), siteUrl: siteUrl(),
  };
}
