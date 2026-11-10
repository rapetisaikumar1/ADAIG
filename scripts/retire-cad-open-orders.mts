// USD-only switch (Nov 2026): cancel OPEN, UNPAID orders in a currency that is no longer offered (CAD).
// Paid history (active/cancelled/refunded memberships, confirmed tickets) is never touched and keeps its currency.
// Conditional updates + one audit entry per row → idempotent. Usage: npx tsx scripts/retire-cad-open-orders.mts [--dry-run]
import { scriptDb } from "./lib/script-db";
const { db } = scriptDb(); const dry = process.argv.includes("--dry-run"); const actor = "system:usd-only"; const RETIRED = ["CAD"];
const ms = await db.membership.findMany({ where: { status: "pending", currency: { in: RETIRED } }, include: { user: { select: { email: true } } } });
const rs = await db.registration.findMany({ where: { status: "pending_payment", currency: { in: RETIRED } }, include: { user: { select: { email: true } } } });
let n = 0;
for (const m of ms) {
  if (dry) { console.log(`would cancel membership order ${m.id} (${m.user.email}, ${m.tierId}, ${m.currency} ${m.amountCents})`); continue; }
  const r = await db.membership.updateMany({ where: { id: m.id, status: "pending", currency: m.currency }, data: { status: "cancelled", activeSlot: null, autoRenew: false } });
  if (r.count) { n++; await db.auditLog.create({ data: { actor, action: "membership.order_cancelled_currency_retired", target: m.id } }); console.log(`cancelled membership order ${m.id} (${m.user.email}, ${m.currency})`); }
}
for (const x of rs) {
  if (dry) { console.log(`would cancel unpaid ticket ${x.id} (${x.user.email}, ${x.currency} ${x.amountCents})`); continue; }
  const r = await db.registration.updateMany({ where: { id: x.id, status: "pending_payment", currency: x.currency }, data: { status: "cancelled" } });
  if (r.count) { n++; await db.auditLog.create({ data: { actor, action: "event.ticket_cancelled_currency_retired", target: x.id } }); console.log(`cancelled unpaid ticket ${x.id} (${x.user.email}, ${x.currency})`); }
}
console.log(dry ? `${ms.length + rs.length} would be cancelled` : `${n} cancelled`); await db.$disconnect();
