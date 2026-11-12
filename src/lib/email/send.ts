import { db } from "@/lib/db";
import { ADDRESS_IN_TEXT_SQL, cleanAddress, headerSafe, redactAddresses, smtpSettings } from "./config";
import { withinUnverifiedBudget } from "./budget";
import { deliver } from "./transport";
import type { SendEmailInput, SendEmailResult } from "./types";
/**
 * sendEmail(): the one entry point for outgoing email (E1–E4, E7). NEVER throws: call it after the business action has
 * committed, and treat the result as information (staff see failures in the EmailLog table).
 *
 * Every call that is not a "duplicate" leaves exactly one EmailLog row (no bodies stored):
 *   1. claim the row (status "failed", error IN_FLIGHT) before talking to SMTP. With a dedupeKey this insert is the
 *      atomic dedupe check: a key that is already "sent" or still in flight → "duplicate", nothing sent. A key whose earlier
 *      attempt failed or was skipped is claimed again and retried (a cron re-run delivers what failed before).
 *   2. invalid recipient → "failed"; SMTP not configured → "skipped"; over the send budget for visitor-typed recipients
 *      (budget.ts: contact.ack, signup.welcome, join.ack, password.reset_link) → "skipped" with error "budget";
 *      else send (timeouts + one retry, transport.ts).
 *   3. update the row to sent / failed / skipped.
 * If the database is unavailable the email is still sent (logging is best effort; dedupe cannot be guaranteed then).
 */
const IN_FLIGHT = "sending (interrupted if this persists)";
const STALE_MS = 10 * 60_000; // an in-flight row older than this was interrupted (crash/timeout) and may be claimed again

type Claim = { id: string | null } | "duplicate";

async function claim(kind: string, to: string, subject: string, dedupeKey: string | undefined, userId: string | undefined): Promise<Claim> {
  const data = { kind, toEmail: to, subject, status: "failed", error: IN_FLIGHT, dedupeKey: dedupeKey ?? null, userId: userId ?? null };
  try {
    return { id: (await db.emailLog.create({ data, select: { id: true } })).id };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2003" && userId) { // unknown / deleted user id: keep the log row without the link
      return claim(kind, to, subject, dedupeKey, undefined);
    }
    if (code !== "P2002" || !dedupeKey) { logError(kind, null, `log write failed (${code ?? "db error"})`); return { id: null }; }
  }
  // dedupeKey seen before: retry only when the earlier attempt failed or was skipped (or is a stale in-flight row).
  try {
    const stale = new Date(Date.now() - STALE_MS);
    const r = await db.emailLog.updateMany({
      where: { dedupeKey, OR: [{ status: "skipped" }, { status: "failed", NOT: { error: IN_FLIGHT } }, { status: "failed", error: IN_FLIGHT, createdAt: { lt: stale } }] },
      data: { ...data, createdAt: new Date(), messageId: null },
    });
    if (r.count !== 1) return "duplicate";
    const row = await db.emailLog.findUnique({ where: { dedupeKey }, select: { id: true } });
    return { id: row?.id ?? null };
  } catch {
    return "duplicate"; // cannot tell: prefer not sending twice
  }
}

async function finish(id: string | null, status: "sent" | "failed" | "skipped", error?: string, messageId?: string) {
  if (!id) return;
  try {
    await db.emailLog.update({ where: { id }, data: { status, error: error ? redactAddresses(error).slice(0, 300) : null, messageId: messageId?.slice(0, 300) ?? null } });
  } catch { logError("log", id, "log update failed"); }
}

/** Server log line: kind, log id and the short reason only (no addresses, bodies or secrets). */
function logError(kind: string, id: string | null, reason: string) {
  console.error(`[email] ${kind}${id ? ` (EmailLog ${id})` : ""}: ${redactAddresses(reason)}`);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const kind = headerSafe(String(input.kind ?? "unknown"), 60) || "unknown";
    const subject = headerSafe(String(input.subject ?? ""), 200);
    const to = cleanAddress(input.to);
    const rawTo = headerSafe(String(input.to ?? ""), 254).toLowerCase();
    const dedupeKey = input.dedupeKey ? headerSafe(input.dedupeKey, 300) || undefined : undefined;
    const replyTo = input.replyTo ? cleanAddress(input.replyTo) ?? undefined : undefined;

    const c = await claim(kind, to ?? rawTo, subject, dedupeKey, input.userId || undefined);
    if (c === "duplicate") return { status: "duplicate" };

    if (!to) { await finish(c.id, "failed", "invalid recipient address"); return { status: "failed", error: "invalid recipient address" }; }
    if (!subject) { await finish(c.id, "failed", "empty subject"); return { status: "failed", error: "empty subject" }; }
    const { settings, problem } = smtpSettings();
    if (!settings) {
      if (problem) { logError(kind, c.id, `not sent: ${problem}`); await finish(c.id, "failed", problem); return { status: "failed", error: problem }; }
      await finish(c.id, "skipped", "SMTP not configured");
      return { status: "skipped" };
    }

    if (!(await withinUnverifiedBudget(kind, to, c.id !== null))) {
      logError(kind, c.id, "skipped: send budget for unverified recipients reached");
      await finish(c.id, "skipped", "budget");
      return { status: "skipped", error: "budget" };
    }

    const r = await deliver({ to, subject, html: String(input.html ?? ""), text: String(input.text ?? ""), replyTo });
    if (r.ok) { await finish(c.id, "sent", undefined, r.messageId); return { status: "sent", messageId: r.messageId }; }
    logError(kind, c.id, `${r.error} (attempts: ${r.attempts})`);
    await finish(c.id, "failed", r.error);
    return { status: "failed", error: r.error };
  } catch (e) {
    logError(String(input?.kind ?? "unknown"), null, `unexpected: ${e instanceof Error ? e.name : "error"}`);
    return { status: "failed", error: "unexpected error" };
  }
}

/**
 * Privacy (account deletion): replace the stored recipient address on a person's EmailLog rows with "(deleted)", and any
 * address in their `error` text with "[address]".
 * Matches rows by userId and/or by address (the address match also covers rows logged without a userId).
 * Call it AFTER sending the "account deleted" notice. Never throws; returns the number of rows changed.
 */
export async function redactEmailLog(o: { userId?: string; email?: string }): Promise<number> {
  const or = [...(o.userId ? [{ userId: o.userId }] : []), ...(o.email ? [{ toEmail: String(o.email).trim().toLowerCase() }] : [])];
  if (!or.length) return 0;
  try {
    const ids = (await db.emailLog.findMany({ where: { OR: or }, select: { id: true } })).map((r) => r.id);
    if (ids.length) await db.$executeRaw`UPDATE "EmailLog" SET error = regexp_replace(error, ${ADDRESS_IN_TEXT_SQL}, '[address]', 'g') WHERE id = ANY(${ids}::text[]) AND error IS NOT NULL`;
    return (await db.emailLog.updateMany({ where: { OR: or }, data: { toEmail: "(deleted)" } })).count;
  } catch { logError("redact", null, "log redact failed"); return 0; }
}
