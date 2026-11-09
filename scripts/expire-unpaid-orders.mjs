// BUG-042 cleanup job: expire unpaid (status "pending") membership orders older than UNPAID_ORDER_TTL_HOURS (default 24).
// Paid (active) and awaiting-verification orders are never touched. Idempotent. Usage: node scripts/expire-unpaid-orders.mjs [--dry-run]
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient(); const dry = process.argv.includes("--dry-run");
const n = Number(process.env.UNPAID_ORDER_TTL_HOURS); const ttl = Number.isFinite(n) && n > 0 ? n : 24;
const cutoff = new Date(Date.now() - ttl * 3600_000);
const rows = await db.membership.findMany({ where: { status: "pending", createdAt: { lt: cutoff } }, select: { id: true, createdAt: true } });
let done = 0;
for (const r of rows) {
  if (dry) { console.log("would expire", r.id, r.createdAt.toISOString()); continue; }
  const u = await db.membership.updateMany({ where: { id: r.id, status: "pending", createdAt: { lt: cutoff } }, data: { status: "expired", activeSlot: null, autoRenew: false } });
  if (u.count) { done++; await db.auditLog.create({ data: { actor: "system", action: "membership.order_expired", target: r.id } }); }
}
console.log(`TTL ${ttl} h, cutoff ${cutoff.toISOString()}: ${dry ? rows.length + " would expire" : done + " expired"}`);
await db.$disconnect();
