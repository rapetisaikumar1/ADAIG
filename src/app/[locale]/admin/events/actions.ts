"use server";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
export async function createEvent(fd: FormData) {
  const locale = String(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const title = String(fd.get("title")).trim();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
  const pub = String(fd.get("publicPrice") ?? "");
  await db.event.create({ data: { slug, title, titleFr: String(fd.get("titleFr") || "") || null, summary: String(fd.get("summary")), type: String(fd.get("type")), format: String(fd.get("format")), location: String(fd.get("location") || "") || null,
    startsAt: new Date(String(fd.get("startsAt"))), durationMin: Number(fd.get("durationMin")), cpe: Number(fd.get("cpe")), memberPriceCents: Math.round(Number(fd.get("memberPrice") || 0) * 100), publicPriceCents: pub ? Math.round(Number(pub) * 100) : null } });
  await db.auditLog.create({ data: { actor: admin.id, action: "event.created", target: slug } });
  redirect(`/${locale}/admin/events`);
}
export async function togglePublish(fd: FormData) {
  const locale = String(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const e = await db.event.findUnique({ where: { id: String(fd.get("id")) } });
  if (e) await db.event.update({ where: { id: e.id }, data: { published: !e.published } });
  redirect(`/${locale}/admin/events`);
}
