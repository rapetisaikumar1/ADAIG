import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
export async function GET() {
  const admin = await currentAdmin(); if (!admin) return new Response("forbidden", { status: 403 });
  const users = await db.user.findMany({ where: { role: { not: "deleted" } }, include: { memberships: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const rows = [csvRow(["name", "email", "role", "tier", "status", "currency", "organisation", "country", "province", "directoryOptIn", "marketingOptIn", "appliedAt", "approvedAt", "rejectionReason"]),
    ...users.map((u) => csvRow([u.name, u.email, u.role, u.memberships[0]?.tierId, u.memberships[0]?.status, u.memberships[0]?.currency, u.organisation, u.country, u.province, u.directoryOptIn, u.marketingOptIn, u.memberships[0]?.createdAt, u.memberships[0]?.verifiedAt, u.memberships[0]?.rejectionReason]))];
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.members_exported" } });
  return new Response(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="members.csv"' } });
}
