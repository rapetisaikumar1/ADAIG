import { apiAdminPermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
import { etCsvStamp } from "@/lib/audit";
import { idParam } from "@/lib/validation";
import { cpeTitle } from "@/app/[locale]/admin/events/eventForm";
import { regView, regViewWhere, regSearchWhere, cleanQuery } from "@/app/[locale]/admin/events/views";

/** CSV (needs events.view) of one event's registrations (same filters as Admin → Events → event: ?v=<view>&q=<name or email>).
 * Times: ISO (UTC) columns plus "…ET" columns in US Eastern time. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAdminPermission("events", "view"); if (ctx instanceof Response) return ctx; // 403 unless events.view (§3.2)
  const admin = ctx.user;
  const { id } = await params;
  const e = idParam(id) ? await db.event.findUnique({ where: { id } }) : null;
  if (!e) return new Response("not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const regs = await db.registration.findMany({
    where: { eventId: e.id, ...regViewWhere(regView(sp.get("v"))), ...regSearchWhere(cleanQuery(sp.get("q"))) },
    include: { user: { select: { name: true, email: true, organisation: true, role: true } } }, orderBy: { createdAt: "asc" },
  });
  const credited = new Map((await db.cpeEntry.findMany({ where: { eventId: e.id }, select: { userId: true, hours: true } })).map((c) => [c.userId, c.hours]));
  const rows = [csvRow(["event", "eventSlug", "eventStartsAt", "eventStartsET", "name", "email", "organisation", "accountDeleted", "ticket", "status", "amount", "currency", "paymentRef", "registeredAt", "registeredET", "attended", "cpeCredited"]),
    ...regs.map((r) => csvRow([cpeTitle(e), e.slug, e.startsAt, etCsvStamp(e.startsAt), r.user.name, r.user.role === "deleted" ? "" : r.user.email, r.user.organisation, r.user.role === "deleted",
      r.ticket, r.status, (r.amountCents / 100).toFixed(2), r.currency, r.paymentRef, r.createdAt, etCsvStamp(r.createdAt), r.attended, credited.get(r.userId) ?? ""]))];
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.event_registrations_exported", target: e.id } });
  const name = `registrations-${e.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 80) || "event"}.csv`;
  return new Response(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
