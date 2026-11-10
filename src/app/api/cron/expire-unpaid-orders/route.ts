import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
/**
 * Scheduled job (vercel.json → daily): expires legacy unpaid membership orders older than UNPAID_ORDER_TTL_HOURS, the same
 * work as `npm run expire-unpaid-orders` and the lazy expiry on access (src/lib/membership.ts expireUnpaid; idempotent).
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it when CRON_SECRET is set). No secret configured → 503,
 * wrong or missing token → 401. Each run writes `system.cron_expire_unpaid_orders` to the audit log (Admin → System shows the last run).
 * The same run also deletes stale LoginThrottle rows (src/lib/rateLimit.ts pruneLoginThrottle; count in `throttlePruned`).
 */
export const dynamic = "force-dynamic";
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
    const [{ expireUnpaid }, { db }, { pruneLoginThrottle }] = await Promise.all([import("@/lib/membership"), import("@/lib/db"), import("@/lib/rateLimit")]);
    const expired = await expireUnpaid();
    await db.auditLog.create({ data: { actor: "system", action: "system.cron_expire_unpaid_orders", target: `expired:${expired}` } });
    const throttlePruned = await pruneLoginThrottle(); // stale login-throttle rows (no lock and no failure for 24 h, or lock ended > 24 h ago)
    return NextResponse.json({ ok: true, expired, throttlePruned }, { headers });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    console.error("[cron] expire-unpaid-orders failed:", err?.message || err?.code || String(e));
    return NextResponse.json({ ok: false, error: "job failed" }, { status: 500, headers });
  }
}
