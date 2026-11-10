import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
import { etCsvStamp } from "@/lib/audit";
/** Contact-form messages as CSV (?f=new|handled, default all). Admins only (role read from the DB). Times: ISO (UTC) + ET columns. */
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const admin = await currentAdmin(); if (!admin) return new Response("forbidden", { status: 403 });
  const f = new URL(req.url).searchParams.get("f");
  const status = f === "new" || f === "handled" ? f : undefined;
  const rows = await db.contactMessage.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" } });
  const out = [csvRow(["receivedAt", "status", "topic", "name", "email", "organization", "locale", "signedInUserId", "message", "handledAt", "receivedET", "handledET"]),
    ...rows.map((m) => csvRow([m.createdAt, m.status, m.topic, m.name, m.email, m.organization, m.locale, m.userId, m.message, m.handledAt, etCsvStamp(m.createdAt), etCsvStamp(m.handledAt)]))];
  await db.auditLog.create({ data: { actor: admin.id, action: "admin.messages_exported", target: `rows:${rows.length}` } });
  return new Response(out.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="contact-messages.csv"', "cache-control": "no-store" } });
}
