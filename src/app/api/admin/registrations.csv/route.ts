import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
import { etCsvStamp } from "@/lib/audit";
/** Event registrations across all events as CSV (per-event export: /api/admin/events/[id]/registrations.csv). Admins only (role read from the DB).
 * Times: ISO (UTC) columns plus "…ET" columns in US Eastern time, as shown in the admin screens. */
export const dynamic = "force-dynamic";
export async function GET() {
  const admin = await currentAdmin(); if (!admin) return new Response("forbidden", { status: 403 });
  const rows = await db.registration.findMany({
    include: { event: { select: { title: true, slug: true, startsAt: true } }, user: { select: { name: true, email: true, role: true } } },
    orderBy: [{ event: { startsAt: "desc" } }, { createdAt: "asc" }],
  });
  const out = [csvRow(["eventTitle", "eventSlug", "eventStartsAt", "eventStartsET", "name", "email", "ticket", "status", "amount", "currency", "attended", "registeredAt", "registeredET"]),
    ...rows.map((r) => {
      const gone = r.user.role === "deleted"; // anonymized account: no personal data in exports
      return csvRow([r.event.title, r.event.slug, r.event.startsAt, etCsvStamp(r.event.startsAt), gone ? "" : r.user.name, gone ? "" : r.user.email, r.ticket, r.status, (r.amountCents / 100).toFixed(2), r.currency, r.attended, r.createdAt, etCsvStamp(r.createdAt)]);
    })];
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.registrations_exported", target: `rows:${rows.length}` } });
  return new Response(out.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="registrations.csv"', "cache-control": "no-store" } });
}
