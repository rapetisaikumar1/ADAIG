/**
 * Mailpit helpers (round 8): the local SMTP catcher that receives every email the app under test sends.
 * SMTP 127.0.0.1:1025 (the app's SMTP_HOST/SMTP_PORT), web UI + API at MAILPIT_URL (default http://127.0.0.1:8025).
 * Mailpit is shared by everything on this machine: prefer unique recipient addresses (e.g. `e2e-<stamp>@example.test`)
 * and waitForEmail({ to }) over clearMailbox(), which deletes ALL messages.
 */
export const MAILPIT_URL = (process.env.MAILPIT_URL || "http://127.0.0.1:8025").replace(/\/$/, "");

type Addr = { Name?: string; Address: string };
type Summary = { ID: string; Subject: string; From: Addr; To: Addr[] | null; Created: string };
type Detail = Summary & { ReplyTo: Addr[] | null; HTML: string; Text: string };

export type MailSummary = { id: string; subject: string; from: string; to: string[]; created: string };
export type Mail = {
  id: string; subject: string; html: string; text: string;
  /** "Name <address>" (or the bare address when no name), as sent. */
  from: string;
  /** Bare lower-cased addresses. */
  replyTo: string[]; to: string[];
};

const fmt = (a: Addr) => (a.Name ? `${a.Name} <${a.Address}>` : a.Address);
const addrs = (l: Addr[] | null | undefined) => (l ?? []).map((a) => a.Address.toLowerCase());

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}${path}`, init);
  if (!res.ok) throw new Error(`Mailpit ${init?.method ?? "GET"} ${path}: HTTP ${res.status} (is Mailpit running at ${MAILPIT_URL}?)`);
  return (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as T) : (undefined as T);
}

/** Delete every message in Mailpit. */
export async function clearMailbox(): Promise<void> {
  await api("/api/v1/messages", { method: "DELETE" });
}

/** Newest first. `query` uses Mailpit search syntax (e.g. `to:"a@b.test"`); without it, the latest `limit` messages. */
export async function listEmails(query?: string, limit = 200): Promise<MailSummary[]> {
  const r = await api<{ messages: Summary[] }>(query
    ? `/api/v1/search?query=${encodeURIComponent(query)}&limit=${limit}`
    : `/api/v1/messages?limit=${limit}`);
  return (r.messages ?? []).map((m) => ({ id: m.ID, subject: m.Subject, from: fmt(m.From), to: addrs(m.To), created: m.Created }));
}

/** One message with its HTML and text bodies. */
export async function getEmail(id: string): Promise<Mail> {
  const m = await api<Detail>(`/api/v1/message/${encodeURIComponent(id)}`);
  return { id: m.ID, subject: m.Subject, html: m.HTML ?? "", text: m.Text ?? "", from: fmt(m.From), replyTo: addrs(m.ReplyTo), to: addrs(m.To) };
}

/**
 * Poll until a message to `to` (case-insensitive) whose subject contains `subjectIncludes` (if given) arrives; returns the
 * newest match. `after` ignores messages created before that time (e.g. the start of the test). Throws after `timeout` ms.
 */
export async function waitForEmail(o: { to: string; subjectIncludes?: string; timeout?: number; after?: Date }): Promise<Mail> {
  const to = o.to.trim().toLowerCase();
  const deadline = Date.now() + (o.timeout ?? 15_000);
  for (;;) {
    const hit = (await listEmails(`to:"${to}"`)).find((m) =>
      m.to.includes(to) && (!o.subjectIncludes || m.subject.includes(o.subjectIncludes)) && (!o.after || new Date(m.created) >= o.after));
    if (hit) return getEmail(hit.id);
    if (Date.now() > deadline) throw new Error(`No email to ${to}${o.subjectIncludes ? ` with subject containing "${o.subjectIncludes}"` : ""} within ${o.timeout ?? 15_000} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Assert-style helper: resolves true when NO matching email arrives within `ms` (for "no account enumeration" checks). */
export async function expectNoEmail(o: { to: string; subjectIncludes?: string; ms?: number; after?: Date }): Promise<boolean> {
  try { await waitForEmail({ ...o, timeout: o.ms ?? 3_000 }); return false; } catch { return true; }
}
