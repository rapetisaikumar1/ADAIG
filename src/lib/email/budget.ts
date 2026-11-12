import { db } from "@/lib/db";
import { ADDRESS_KEY_SQL, addressKey } from "../validation";
/**
 * Send budget for emails that go to an address a visitor typed and nobody verified (round-8 SEC M1: mail floods in ADAIG's
 * name). Counted from EmailLog (no extra table) over the last hour, for these kinds together:
 *   - per recipient: at most PER_RECIPIENT_HOURLY, by counting key (lower case, "+tag" removed: x@d and x+1@d are one person);
 *   - in total: at most EMAIL_UNVERIFIED_HOURLY_CAP (default 60).
 * Over budget → sendEmail() records the email as "skipped" with error "budget" and sends nothing. The business action (message,
 * account, application, reset token) is already saved, and the visitor sees the same answer either way.
 * Rows count when they were sent or attempted (sent / failed / in flight); "skipped" rows (budget, SMTP not configured) don't,
 * so a flood that is being refused does not extend its own block.
 * Two separate pools: password reset links are counted on their own, so flooding someone's address with contact / sign-up /
 * join acknowledgements can never use up the budget a real password reset needs (and vice versa).
 */
export const BUDGET_KINDS: readonly string[] = ["contact.ack", "signup.welcome", "join.ack", "password.reset_link"];
export const PER_RECIPIENT_HOURLY = 3;
const RESET_POOL: readonly string[] = ["password.reset_link"];
const poolOf = (kind: string): string[] => (RESET_POOL.includes(kind) ? [...RESET_POOL] : BUDGET_KINDS.filter((k) => !RESET_POOL.includes(k)));
const DEFAULT_HOURLY_CAP = 60;
const WINDOW_MS = 3600_000;

export function unverifiedHourlyCap(): number {
  const v = Number(process.env.EMAIL_UNVERIFIED_HOURLY_CAP?.trim());
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_HOURLY_CAP;
}

/**
 * True while this email is within budget. Call it AFTER the EmailLog row of this send was claimed (`claimed`): the counts then
 * include this send and every concurrent one, so two racing sends can both be refused at the limit but never both get past it.
 * A database error allows the send (logging is best effort, like the rest of sendEmail).
 */
export async function withinUnverifiedBudget(kind: string, to: string, claimed: boolean): Promise<boolean> {
  if (!BUDGET_KINDS.includes(kind)) return true;
  try {
    const since = new Date(Date.now() - WINDOW_MS);
    const [r] = await db.$queryRaw<{ mine: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE regexp_replace(lower(trim("toEmail")), ${ADDRESS_KEY_SQL.re}, ${ADDRESS_KEY_SQL.to}) = ${addressKey(to)})::int AS mine,
             count(*)::int AS total
      FROM "EmailLog"
      WHERE kind = ANY(${poolOf(kind)}::text[]) AND status <> 'skipped' AND "createdAt" > ${since}::timestamptz`;
    const self = claimed ? 0 : 1; // without a log row, this send is not in the counts yet
    return (r?.mine ?? 0) + self <= PER_RECIPIENT_HOURLY && (r?.total ?? 0) + self <= unverifiedHourlyCap();
  } catch {
    return true;
  }
}
