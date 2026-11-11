import { headers } from "next/headers";
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
 * The same table also holds the anonymous-write buckets below (keys "c:<ip>" contact, "a:<ip>" account creation) and the
 * delete-account password counter ("del:<userId>", reserveDeleteAttempt).
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
  return reserveKey(`e:${email}`);
}
/**
 * Same counter and thresholds as reserveAttempt, in a separate key namespace "del:<userId>" (round-7 fix S6 / SEC L-5):
 * the password check of Profile → "Delete my account". Kept apart so these attempts never lock or unlock sign-in.
 */
export async function reserveDeleteAttempt(userId: string): Promise<boolean> {
  return reserveKey(`del:${userId}`);
}
export async function clearDeleteFailures(userId: string) { await db.loginThrottle.deleteMany({ where: { key: `del:${userId}` } }); }

async function reserveKey(key: string): Promise<boolean> {
  const now = new Date();
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

/* ───────────── Anonymous writes (S1-3): contact form, signup, join ─────────────
 * Global caps (always on) bound table growth and bcrypt CPU even when the client IP is unknown. Per-IP caps apply only with
 * TRUSTED_PROXY=true (see clientIp). Counters: the global ones count real rows (ContactMessage / User created in the window);
 * the per-IP ones are fixed-window buckets in LoginThrottle (failures = hits, lastFailAt = window start, lockedUntil unused),
 * incremented atomically, and pruned by pruneLoginThrottle like the login rows. The existing 5-per-email contact limit stays.
 */
const anonWriteLimits = {
  windowMs: 3600_000, // 1 hour
  contactPerIp: 10, // contact messages per IP per hour
  contactGlobal: 200, // contact messages (all senders) per hour
  accountsPerIp: 5, // new accounts (signup + join) attempted per IP per hour
  accountsGlobal: 100, // new accounts created (all visitors) per hour
};

/** One hit on a fixed-window bucket; true while the window's hit count (this one included) is within `max`. */
async function hitBucket(key: string, max: number, windowMs = anonWriteLimits.windowMs): Promise<boolean> {
  const now = new Date();
  const rows = await db.$queryRaw<{ failures: number }[]>`
    INSERT INTO "LoginThrottle" AS t (key, failures, "lastFailAt") VALUES (${key}, 1, ${now}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN t."lastFailAt" > ${now}::timestamptz - ${windowMs}::float8 * interval '1 millisecond' THEN t.failures + 1 ELSE 1 END,
      "lastFailAt" = CASE WHEN t."lastFailAt" > ${now}::timestamptz - ${windowMs}::float8 * interval '1 millisecond' THEN t."lastFailAt" ELSE ${now}::timestamptz END
    RETURNING failures`;
  return (rows[0]?.failures ?? 1) <= max;
}

/**
 * Contact form: call after validation, right before saving. False → answer with the "sent several messages recently" error.
 * Checks the global hourly cap, then counts one hit on the sender IP's bucket (trusted proxy only).
 */
export async function allowContactMessage(): Promise<boolean> {
  const since = new Date(Date.now() - anonWriteLimits.windowMs);
  if ((await db.contactMessage.count({ where: { createdAt: { gt: since } } })) >= anonWriteLimits.contactGlobal) return false;
  const ip = clientIp(await headers());
  return ip ? hitBucket(`c:${ip}`, anonWriteLimits.contactPerIp) : true;
}

/**
 * Signup and join (signed-out visitors): call after validation and BEFORE hashing the password, for every attempt (also for
 * emails that turn out to exist, so the answer reveals nothing). False → refuse with a "too many attempts, try later" error.
 */
export async function allowAccountCreation(): Promise<boolean> {
  const since = new Date(Date.now() - anonWriteLimits.windowMs);
  // Only self-service accounts count: Admin Portal accounts (role admin) are created by staff in Admin → Users (round-7 S7).
  if ((await db.user.count({ where: { createdAt: { gt: since }, role: { not: "admin" } } })) >= anonWriteLimits.accountsGlobal) return false;
  const ip = clientIp(await headers());
  return ip ? hitBucket(`a:${ip}`, anonWriteLimits.accountsPerIp) : true;
}
