// Daily housekeeping, same work as the cron route /api/cron/expire-unpaid-orders (src/lib/membership.ts membershipHousekeeping):
// 1. BUG-042: expire unpaid (status "pending") membership orders older than UNPAID_ORDER_TTL_HOURS (default 24).
//    Paid (active) and awaiting-verification orders are never touched.
// 2. Lapse active memberships whose renewal date is more than 30 days past (LAPSE_GRACE_DAYS), member → guest unless another
//    membership is active (admins keep their role), audit "membership.lapsed_auto".
// 3. Delete stale login-throttle / rate-limit rows. Idempotent. Usage: npm run expire-unpaid-orders [-- --dry-run]
import { scriptDb } from "./lib/script-db";
const { db } = scriptDb(); const dry = process.argv.includes("--dry-run");
// Admin → Settings ("ops".unpaidOrderTtlHours) wins, else env UNPAID_ORDER_TTL_HOURS, else 24 (same order as src/lib/settings.ts).
const n = Number(process.env.UNPAID_ORDER_TTL_HOURS); const envTtl = Number.isFinite(n) && n > 0 ? n : 24;
const ops = (await db.setting.findUnique({ where: { key: "ops" } }))?.value as { unpaidOrderTtlHours?: unknown } | null | undefined;
const dbTtl = typeof ops?.unpaidOrderTtlHours === "number" && ops.unpaidOrderTtlHours > 0 ? ops.unpaidOrderTtlHours : null;
const ttl = dbTtl ?? envTtl;
const cutoff = new Date(Date.now() - ttl * 3600_000);
const rows = await db.membership.findMany({ where: { status: "pending", createdAt: { lt: cutoff } }, select: { id: true, createdAt: true } });
let done = 0;
for (const r of rows) {
  if (dry) { console.log("would expire", r.id, r.createdAt.toISOString()); continue; }
  const u = await db.membership.updateMany({ where: { id: r.id, status: "pending", createdAt: { lt: cutoff } }, data: { status: "expired", activeSlot: null, autoRenew: false } });
  if (u.count) { done++; await db.auditLog.create({ data: { actor: "system", action: "membership.order_expired", target: r.id } }); }
}
console.log(`TTL ${ttl} h, cutoff ${cutoff.toISOString()}: ${dry ? rows.length + " would expire" : done + " expired"}`);
// Auto-lapse (same rule as lapseOverdue in src/lib/membership.ts; keep LAPSE_GRACE_DAYS in sync).
const LAPSE_GRACE_DAYS = 30;
const lapseCutoff = new Date(Date.now() - LAPSE_GRACE_DAYS * 864e5);
const overdue = await db.membership.findMany({ where: { status: "active", renewsAt: { lt: lapseCutoff } }, select: { id: true, userId: true, renewsAt: true } });
let lapsed = 0;
for (const m of overdue) {
  if (dry) { console.log("would lapse", m.id, m.renewsAt?.toISOString()); continue; }
  const ok = await db.$transaction(async (tx) => {
    const r = await tx.membership.updateMany({ where: { id: m.id, status: "active", renewsAt: { lt: lapseCutoff } }, data: { status: "lapsed", activeSlot: null, autoRenew: false } });
    if (!r.count) return false;
    await tx.user.updateMany({ where: { id: m.userId, role: "member", memberships: { none: { status: "active" } } }, data: { role: "guest" } });
    await tx.auditLog.create({ data: { actor: "system", action: "membership.lapsed_auto", target: m.id } });
    return true;
  });
  if (ok) lapsed++;
}
console.log(`Renewal grace ${LAPSE_GRACE_DAYS} days, renewal before ${lapseCutoff.toISOString()}: ${dry ? overdue.length + " would lapse" : lapsed + " lapsed"}`);
// Stale login-throttle rows, as the cron route does (src/lib/rateLimit.ts pruneLoginThrottle): no lock and no failure for 24 h, or lock ended > 24 h ago.
const day = new Date(Date.now() - 24 * 3600_000);
const stale = { OR: [{ lockedUntil: null, lastFailAt: { lt: day } }, { lockedUntil: { lt: day } }] };
console.log(dry ? `${await db.loginThrottle.count({ where: stale })} stale login-throttle rows would be deleted` : `${(await db.loginThrottle.deleteMany({ where: stale })).count} stale login-throttle rows deleted`);
await db.$disconnect();
