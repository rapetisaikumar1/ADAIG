import { loginRateLimit as L } from "@/config/site";
import { db } from "@/lib/db";
/**
 * Login throttling (QA BUG-008/021/022/026). Counters are stored in the DB, so they survive restarts and are shared across instances.
 * - Per account: after L.maxPerEmail failures, exponential backoff lock (1 min doubling to 15 min).
 *   Each attempt is counted BEFORE the password is checked, in one atomic statement (reserveAttempt), so parallel requests
 *   can't all slip past the lock check: at most L.maxPerEmail passwords are evaluated before the account locks.
 *   A successful login clears the counter (clearFailures).
 * - Per IP: ONLY when TRUSTED_PROXY=true (the IP comes from the proxy-appended X-Forwarded-For hop). Never locks anyone,
 *   it only delays responses. Without a trusted proxy the client IP is unknown/spoofable, so no IP bucket is used.
 * Stale rows are removed by pruneLoginThrottle() (daily cron job).
 */
export function clientIp(h: Headers): string | null {
  if (process.env.TRUSTED_PROXY !== "true") return null;
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1));
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length >= hops ? xff[xff.length - hops] : null; // rightmost entries are added by our own proxies; left ones are client-controlled
}
const fresh = (r: { lastFailAt: Date } | null) => !!r && Date.now() - r.lastFailAt.getTime() < L.windowMs;

/** Slow down (never block) when one trusted IP produces many failures. */
export async function ipDelay(ip: string | null) {
  if (!ip) return;
  const r = await db.loginThrottle.findUnique({ where: { key: `i:${ip}` } });
  const over = fresh(r) ? r!.failures - L.maxPerIp : 0;
  if (over > 0) await new Promise((res) => setTimeout(res, Math.min(over * L.ipDelayStepMs, L.ipDelayMaxMs)));
}

/**
 * Count one login attempt for this email, atomically, before the password is checked. Returns false (refuse, "locked")
 * when the account is locked; nothing is counted then. Otherwise the attempt counts as a failure until clearFailures():
 * failures older than the window are forgotten, and reaching L.maxPerEmail sets the lock (1 min, doubling, max 15 min).
 * Single INSERT … ON CONFLICT DO UPDATE … WHERE: concurrent attempts are serialized on the row, and a locked row is not
 * updated, so RETURNING yields no row.
 */
export async function reserveAttempt(email: string): Promise<boolean> {
  const key = `e:${email}`, now = new Date();
  const rows = await db.$queryRaw<{ failures: number }[]>`
    INSERT INTO "LoginThrottle" AS t (key, failures, "lastFailAt", "lockedUntil")
    VALUES (${key}, 1, ${now}::timestamptz,
      CASE WHEN 1 >= ${L.maxPerEmail}::int
        THEN ${now}::timestamptz + LEAST(${L.baseLockMs}::float8 * power(2, 1 - ${L.maxPerEmail}::int), ${L.maxLockMs}::float8) * interval '1 millisecond' END)
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN t."lastFailAt" > ${now}::timestamptz - ${L.windowMs}::float8 * interval '1 millisecond' THEN t.failures + 1 ELSE 1 END,
      "lastFailAt" = ${now}::timestamptz,
      "lockedUntil" = CASE
        WHEN (CASE WHEN t."lastFailAt" > ${now}::timestamptz - ${L.windowMs}::float8 * interval '1 millisecond' THEN t.failures + 1 ELSE 1 END) >= ${L.maxPerEmail}::int
        THEN ${now}::timestamptz + LEAST(${L.baseLockMs}::float8 * power(2, (CASE WHEN t."lastFailAt" > ${now}::timestamptz - ${L.windowMs}::float8 * interval '1 millisecond' THEN t.failures + 1 ELSE 1 END) - ${L.maxPerEmail}::int), ${L.maxLockMs}::float8) * interval '1 millisecond'
        ELSE t."lockedUntil" END
    WHERE t."lockedUntil" IS NULL OR t."lockedUntil" <= ${now}::timestamptz
    RETURNING failures`;
  return rows.length > 0;
}
/** One failed attempt from a trusted IP (atomic; only slows that IP down, see ipDelay). */
export async function recordIpFailure(ip: string | null) {
  if (!ip) return;
  const key = `i:${ip}`, now = new Date();
  await db.$executeRaw`
    INSERT INTO "LoginThrottle" AS t (key, failures, "lastFailAt") VALUES (${key}, 1, ${now}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN t."lastFailAt" > ${now}::timestamptz - ${L.windowMs}::float8 * interval '1 millisecond' THEN t.failures + 1 ELSE 1 END,
      "lastFailAt" = ${now}::timestamptz`;
}
export async function clearFailures(email: string) { await db.loginThrottle.deleteMany({ where: { key: `e:${email}` } }); }

/** Housekeeping: rows with no lock and no failure for 24 h, and locks that ended more than 24 h ago. Returns the count. */
export async function pruneLoginThrottle(now = new Date()) {
  const cutoff = new Date(now.getTime() - 24 * 3600_000);
  const r = await db.loginThrottle.deleteMany({ where: { OR: [{ lockedUntil: null, lastFailAt: { lt: cutoff } }, { lockedUntil: { lt: cutoff } }] } });
  return r.count;
}
