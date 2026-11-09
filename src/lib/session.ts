import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
export async function requireUser(locale: string) {
  const s = await auth();
  if (!s?.user?.id) redirect(`/${locale}/login`);
  const user = await db.user.findUnique({ where: { id: s.user.id } });
  if (!user || user.role === "deleted") redirect(`/${locale}/login`);
  return user;
}
export async function requireAdmin(locale: string) {
  const u = await requireUser(locale);
  if (u.role !== "admin") redirect(`/${locale}/my/dashboard`);
  return u;
}
export async function activeMembership(userId: string) {
  return db.membership.findFirst({ where: { userId, status: "active" }, orderBy: { createdAt: "desc" } });
}
