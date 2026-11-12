import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
/**
 * Scheduled job (vercel.json → daily): expires legacy unpaid membership orders older than UNPAID_ORDER_TTL_HOURS and lapses
 * active memberships more than 30 days past their renewal date (audit "membership.lapsed_auto" per membership). Same work as
 * `npm run expire-unpaid-orders` and the lazy housekeeping on access (src/lib/membership.ts membershipHousekeeping; idempotent).
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it when CRON_SECRET is set). No secret configured → 503,
 * wrong or missing token → 401. Each run writes `system.cron_expire_unpaid_orders` to the audit log, target `expired:<n>`
 * (Admin → System shows the last run and parses that target, so its format stays); the lapsed count is in the JSON response.
 * The same run also deletes stale LoginThrottle rows (src/lib/rateLimit.ts pruneLoginThrottle; count in `throttlePruned`) and
 * password reset tokens used or expired more than a day ago (`resetTokensPruned`), then emails renewal reminders (renewal date
 * passed within the last 14 days, once per renewal period) and lapse notices (automatic lapses of the last 7 days, including
 * those done lazily or by the script) — src/lib/notify/membership.ts sendMembershipLifecycleEmails, counts in `emails`
 * (null when that step failed). The email step never turns the run into a 500.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store, max-age=0" };

function tokenOk(header: string | null, secret: string) {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim()), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "cron disabled: CRON_SECRET is not set" }, { status: 503, headers });
  if (!tokenOk(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  try {
    const [{ membershipHousekeeping }, { db }, { pruneLoginThrottle }] = await Promise.all([import("@/lib/membership"), import("@/lib/db"), import("@/lib/rateLimit")]);
    const { expired, lapsed } = await membershipHousekeeping();
    await db.auditLog.create({ data: { actor: "system", action: "system.cron_expire_unpaid_orders", target: `expired:${expired}` } });
    const throttlePruned = await pruneLoginThrottle(); // stale login-throttle rows (no lock and no hit for 24 h, or lock ended > 24 h ago) + ended one-hour pr:/pi:/c:/a: buckets
    const dayAgo = new Date(Date.now() - 864e5);
    const resetTokensPruned = await db.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { usedAt: { lt: dayAgo } }] } })
      .then((r) => r.count).catch((e) => { console.error("[cron] reset token prune failed:", (e as Error)?.message?.slice(0, 120)); return null; });
    let emails = null;
    try { emails = await (await import("@/lib/notify/membership")).sendMembershipLifecycleEmails(); }
    catch (e) { console.error("[cron] membership emails failed:", (e as Error)?.message?.slice(0, 120)); }
    return NextResponse.json({ ok: true, expired, lapsed, throttlePruned, resetTokensPruned, emails }, { headers });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    console.error("[cron] expire-unpaid-orders failed:", err?.message || err?.code || String(e));
    return NextResponse.json({ ok: false, error: "job failed" }, { status: 500, headers });
  }
}
