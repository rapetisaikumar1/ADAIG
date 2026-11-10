import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { csvRow } from "@/lib/csv";
// US-8: member data export as JSON (default) or CSV (?format=csv). Excludes password hash.
export async function GET(req: Request) {
  const s = await auth(); if (!s?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = await db.user.findUnique({ where: { id: s.user.id }, include: { memberships: true, registrations: { include: { event: { select: { title: true, startsAt: true } } } }, cpe: true } });
  if (!u) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { passwordHash: _omit, sessionVersion: _sv, ...data } = u; void _omit; void _sv;
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const lines = [csvRow(["section", "field", "value"])];
    for (const [k, v] of Object.entries(data)) if (!Array.isArray(v)) lines.push(csvRow(["profile", k, v]));
    u.memberships.forEach((m, i) => Object.entries(m).forEach(([k, v]) => lines.push(csvRow([`membership_${i + 1}`, k, v]))));
    u.registrations.forEach((r, i) => { const { event, ...rest } = r; Object.entries({ ...rest, eventTitle: event.title, eventStartsAt: event.startsAt }).forEach(([k, v]) => lines.push(csvRow([`registration_${i + 1}`, k, v]))); });
    u.cpe.forEach((c, i) => Object.entries(c).forEach(([k, v]) => lines.push(csvRow([`cpe_${i + 1}`, k, v]))));
    return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="adaig-my-data.csv"', "cache-control": "no-store" } });
  }
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="adaig-my-data.json"', "cache-control": "no-store" } });
}
