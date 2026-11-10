// BUG-042 cleanup job: expire unpaid (status "pending") membership orders older than UNPAID_ORDER_TTL_HOURS (default 24).
// Paid (active) and awaiting-verification orders are never touched. Also deletes stale login-throttle rows. Idempotent. Usage: npm run expire-unpaid-orders [-- --dry-run]
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
// Stale login-throttle rows, as the cron route does (src/lib/rateLimit.ts pruneLoginThrottle): no lock and no failure for 24 h, or lock ended > 24 h ago.
const day = new Date(Date.now() - 24 * 3600_000);
const stale = { OR: [{ lockedUntil: null, lastFailAt: { lt: day } }, { lockedUntil: { lt: day } }] };
console.log(dry ? `${await db.loginThrottle.count({ where: stale })} stale login-throttle rows would be deleted` : `${(await db.loginThrottle.deleteMany({ where: stale })).count} stale login-throttle rows deleted`);
await db.$disconnect();
