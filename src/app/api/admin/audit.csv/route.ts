import { apiAdminPermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
import { AUDIT_CSV_MAX, auditWhere, parseAuditFilters, etCsvStamp } from "@/lib/audit";
/** Audit log as CSV, with the same filters as Admin → Audit log (query string a / actor / target / from / to). Needs system.view (permissions read from the DB).
 * createdAt is ISO (UTC); createdET is the same time in US Eastern time, as shown on the page. */
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const ctx = await apiAdminPermission("system", "view"); if (ctx instanceof Response) return ctx; // 403 unless system.view (§3.2)
  const admin = ctx.user;
  const f = parseAuditFilters(new URL(req.url).searchParams);
  const rows = await db.auditLog.findMany({ where: await auditWhere(f), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: AUDIT_CSV_MAX });
  const actors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actor))] } }, select: { id: true, email: true, role: true } });
  const email = new Map(actors.map((u) => [u.id, u.role === "deleted" ? "" : u.email]));
  const out = [csvRow(["createdAt", "action", "actor", "actorEmail", "target", "createdET"]), ...rows.map((r) => csvRow([r.createdAt, r.action, r.actor, email.get(r.actor), r.target, etCsvStamp(r.createdAt)]))];
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.audit_exported", target: `rows:${rows.length}` } });
  return new Response(out.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-log.csv"', "cache-control": "no-store" } });
}
