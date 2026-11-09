import { loginRateLimit as L } from "@/config/site";
import { db } from "@/lib/db";
/**
 * Login throttling (QA BUG-008/021/022/026). Counters are stored in the DB, so they survive restarts and are shared across instances.
 * - Per account: after L.maxPerEmail failures, exponential backoff lock (1 min doubling to 15 min).
 * - Per IP: ONLY when TRUSTED_PROXY=true (the IP comes from the proxy-appended X-Forwarded-For hop). Never locks anyone,
 *   it only delays responses. Without a trusted proxy the client IP is unknown/spoofable, so no IP bucket is used.
 */
export function clientIp(h: Headers): string | null {
  if (process.env.TRUSTED_PROXY !== "true") return null;
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1));
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length >= hops ? xff[xff.length - hops] : null; // rightmost entries are added by our own proxies; left ones are client-controlled
}
const fresh = (r: { lastFailAt: Date } | null) => !!r && Date.now() - r.lastFailAt.getTime() < L.windowMs;

export async function isLocked(email: string) {
  const r = await db.loginThrottle.findUnique({ where: { key: `e:${email}` } });
  return !!r?.lockedUntil && r.lockedUntil.getTime() > Date.now();
}
/** Slow down (never block) when one trusted IP produces many failures. */
export async function ipDelay(ip: string | null) {
  if (!ip) return;
  const r = await db.loginThrottle.findUnique({ where: { key: `i:${ip}` } });
  const over = fresh(r) ? r!.failures - L.maxPerIp : 0;
  if (over > 0) await new Promise((res) => setTimeout(res, Math.min(over * L.ipDelayStepMs, L.ipDelayMaxMs)));
}
async function bump(key: string) {
  const r = await db.loginThrottle.findUnique({ where: { key } });
  const failures = (fresh(r) ? r!.failures : 0) + 1;
  return db.loginThrottle.upsert({ where: { key }, create: { key, failures, lastFailAt: new Date() }, update: { failures, lastFailAt: new Date() } });
}
export async function recordFailure(email: string, ip: string | null) {
  const r = await bump(`e:${email}`);
  if (r.failures >= L.maxPerEmail) {
    const ms = Math.min(L.baseLockMs * 2 ** (r.failures - L.maxPerEmail), L.maxLockMs);
    await db.loginThrottle.update({ where: { key: r.key }, data: { lockedUntil: new Date(Date.now() + ms) } });
  }
  if (ip) await bump(`i:${ip}`);
}
export async function clearFailures(email: string) { await db.loginThrottle.deleteMany({ where: { key: `e:${email}` } }); }
