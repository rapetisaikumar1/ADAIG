import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { headerSafe, redactAddresses, smtpSettings, type SmtpSettings } from "./config";
/**
 * The ONLY place that talks SMTP (nodemailer). Lazy singleton, rebuilt when the SMTP settings change.
 * Plain (non-pooled) SMTP: one connection per message, which suits serverless functions.
 * Timeouts ~10 s; one retry after 1.5 s on transient errors (connection/timeout/socket/DNS, 4xx replies); never on 5xx or auth errors.
 */
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_500;

type Cached = { key: string; transporter: Transporter };
const g = globalThis as unknown as { __adaigMailer?: Cached };

function transporterFor(s: SmtpSettings): Transporter {
  const key = JSON.stringify([s.host, s.port, s.secure, s.requireTLS, s.auth?.user ?? "", s.auth?.pass ?? ""]);
  if (g.__adaigMailer?.key === key) return g.__adaigMailer.transporter;
  g.__adaigMailer?.transporter.close();
  const transporter = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure, requireTLS: s.requireTLS,
    ...(s.auth ? { auth: s.auth } : {}),
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS, dnsTimeout: TIMEOUT_MS,
    disableFileAccess: true, disableUrlAccess: true, // messages never pull local files or remote URLs
    tls: { minVersion: "TLSv1.2" },
    logger: false, debug: false,
  });
  g.__adaigMailer = { key, transporter };
  return transporter;
}

export type Outgoing = { to: string; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string> };
export type DeliverResult =
  | { ok: true; messageId?: string; response?: string; attempts: number }
  | { ok: false; error: string; permanent: boolean; attempts: number };

type SmtpError = { code?: string; responseCode?: number; response?: string; message?: string };
const TRANSIENT_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"]);
export function isTransient(e: SmtpError): boolean {
  if (typeof e.responseCode === "number") return e.responseCode >= 400 && e.responseCode < 500;
  return !!e.code && TRANSIENT_CODES.has(e.code);
}

/**
 * Short, staff-readable reason with no secrets and no addresses: error code + SMTP reply line (server replies never echo
 * credentials, but they often quote the recipient: every address becomes "[address]", round-8 SEC L4).
 */
export function describeError(e: unknown, s?: SmtpSettings | null): string {
  const x = (e ?? {}) as SmtpError;
  const parts = [x.code, x.responseCode ? String(x.responseCode) : "", headerSafe(String(x.response ?? x.message ?? "unknown error"), 300)];
  let out = parts.filter(Boolean).join(" ").replace(/^(\S+) \1\b/, "$1");
  for (const secret of [s?.auth?.pass, s?.auth?.user]) if (secret && secret.length >= 3) out = out.split(secret).join("***");
  return redactAddresses(out).slice(0, 200);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send one message. Never throws. `to` / `replyTo` must already be validated (send.ts / cleanAddress). */
export async function deliver(m: Outgoing): Promise<DeliverResult> {
  let s: SmtpSettings | null = null;
  try {
    const r = smtpSettings();
    s = r.settings;
    if (!s) return { ok: false, error: r.problem ?? "SMTP is not configured", permanent: true, attempts: 0 };
    const transporter = transporterFor(s);
    const mail = {
      from: { name: s.from.name, address: s.from.address },
      to: { name: "", address: m.to },
      ...(m.replyTo ? { replyTo: { name: "", address: m.replyTo } } : {}),
      subject: headerSafe(m.subject, 200),
      text: m.text, html: m.html,
      headers: { "Auto-Submitted": "auto-generated", ...(m.headers ?? {}) },
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const info = await transporter.sendMail(mail);
        const accepted = (info.accepted ?? []).length, rejected = (info.rejected ?? []).length;
        if (!accepted && rejected) return { ok: false, error: describeError({ code: "EENVELOPE", response: String(info.response ?? "recipient rejected") }, s), permanent: true, attempts: attempt };
        return { ok: true, messageId: info.messageId, response: headerSafe(String(info.response ?? ""), 200), attempts: attempt };
      } catch (e) {
        const transient = isTransient(e as SmtpError);
        if (transient && attempt < 2) { await sleep(RETRY_DELAY_MS); continue; }
        return { ok: false, error: describeError(e, s), permanent: !transient, attempts: attempt };
      }
    }
  } catch (e) {
    return { ok: false, error: describeError(e, s), permanent: true, attempts: 0 };
  }
}

/** Check the SMTP connection and login without sending (scripts/send-test-email.mjs). Never throws. */
export async function verifyTransport(): Promise<{ ok: boolean; error?: string }> {
  const { settings: s, problem } = smtpSettings();
  if (!s) return { ok: false, error: problem ?? "SMTP is not configured (SMTP_HOST is empty)" };
  try { await transporterFor(s).verify(); return { ok: true }; } catch (e) { return { ok: false, error: describeError(e, s) }; }
}
