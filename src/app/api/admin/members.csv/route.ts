import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
import { etCsvStamp } from "@/lib/audit";
import { memberFilter, memberQuery, memberSearchWhere, memberTabWhere } from "@/app/[locale]/admin/members/_shared";
/**
 * Accounts (except deleted) with their latest membership as CSV. Same tab and search as Admin → Members (?f=pending|active|other,
 * ?q=name, email or organization), so the file contains what staff see. Admins only (role read from the DB). Times: ISO (UTC) + ET.
 */
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const admin = await currentAdmin(); if (!admin) return new Response("forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const f = memberFilter(sp.get("f")), q = memberQuery(sp.get("q"));
  const users = await db.user.findMany({
    where: { AND: [memberSearchWhere(q), memberTabWhere(f)] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      name: true, email: true, role: true, organisation: true, jobTitle: true, country: true, province: true, directoryOptIn: true, marketingOptIn: true, createdAt: true,
      memberships: { orderBy: { createdAt: "desc" }, take: 1, select: { tierId: true, status: true, currency: true, createdAt: true, verifiedAt: true, renewsAt: true, rejectionReason: true } },
    },
  });
  const rows = [csvRow(["name", "email", "role", "tier", "status", "currency", "organisation", "jobTitle", "country", "province", "directoryOptIn", "marketingOptIn", "appliedAt", "approvedAt", "rejectionReason", "accountCreatedET", "appliedET", "approvedET", "renewsET"]),
    ...users.map((u) => { const m = u.memberships[0]; return csvRow([u.name, u.email, u.role, m?.tierId, m?.status, m?.currency, u.organisation, u.jobTitle, u.country, u.province, u.directoryOptIn, u.marketingOptIn, m?.createdAt, m?.verifiedAt, m?.rejectionReason,
      etCsvStamp(u.createdAt), etCsvStamp(m?.createdAt), etCsvStamp(m?.verifiedAt), etCsvStamp(m?.renewsAt)]); })];
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.members_exported", target: `rows:${users.length}${f !== "all" ? ` f:${f}` : ""}${q ? " (search)" : ""}` } });
  const name = `members${f !== "all" ? `-${f}` : ""}${q ? "-search" : ""}.csv`;
  return new Response(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
