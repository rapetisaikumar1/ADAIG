// QA round 6 one-off data cleanup (reviewed). Touches ONLY:
//  1. qa+upgrade@adaig.test: two ACTIVE memberships → keep the earliest-created active one, cancel the later duplicate(s).
//  2. qa+student-pending@adaig.test: ACTIVE (approval won) but refundStatus "refund_due" + rejectionReason left by the losing reject
//     → clear refundStatus and rejectionReason.
// Each change is a conditional update (re-checks the bad state) + an audit entry, so re-running is a no-op.
// Usage: node scripts/cleanup-r6.mjs [--dry-run]
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient(); const dry = process.argv.includes("--dry-run"); const actor = "system:cleanup-r6"; const log = [];

const up = await db.user.findUnique({ where: { email: "qa+upgrade@adaig.test" } });
if (up) {
  const act = await db.membership.findMany({ where: { userId: up.id, status: "active" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const [keep, ...dups] = act;
  if (keep && !dry) await db.membership.updateMany({ where: { id: keep.id, status: "active", activeSlot: null }, data: { activeSlot: up.id } }).catch(() => {}); // re-arm one-open-membership guard
  for (const d of dups) {
    if (dry) { log.push(`would cancel duplicate ${d.id} (${d.tierId}), keep ${keep.id} (${keep.tierId})`); continue; }
    const r = await db.membership.updateMany({ where: { id: d.id, status: "active" }, data: { status: "cancelled", autoRenew: false, activeSlot: null } });
    if (r.count) { await db.auditLog.create({ data: { actor, action: "membership.duplicate_cancelled", target: d.id } }); log.push(`qa+upgrade: cancelled duplicate active ${d.id} (${d.tierId}, ${d.currency} ${d.amountCents}); kept earliest ${keep.id} (${keep.tierId})`); }
  }
  if (!dups.length) log.push(`qa+upgrade: ${act.length} active membership(s), nothing to do`);
} else log.push("qa+upgrade: user not found");

const sp = await db.user.findUnique({ where: { email: "qa+student-pending@adaig.test" } });
if (sp) {
  const bad = await db.membership.findMany({ where: { userId: sp.id, status: "active", OR: [{ refundStatus: { not: null } }, { rejectionReason: { not: null } }] } });
  for (const m of bad) {
    if (dry) { log.push(`would clear refundStatus=${m.refundStatus} rejectionReason=${JSON.stringify(m.rejectionReason)} on ${m.id}`); continue; }
    const r = await db.membership.updateMany({ where: { id: m.id, status: "active" }, data: { refundStatus: null, rejectionReason: null } });
    if (r.count) { await db.auditLog.create({ data: { actor, action: "membership.inconsistent_refund_flag_cleared", target: m.id } }); log.push(`qa+student-pending: ${m.id} active; cleared refundStatus "${m.refundStatus}" and rejectionReason "${m.rejectionReason}"`); }
  }
  if (!bad.length) log.push("qa+student-pending: already consistent, nothing to do");
} else log.push("qa+student-pending: user not found");
console.log(log.join("\n")); await db.$disconnect();
