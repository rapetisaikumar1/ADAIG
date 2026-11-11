"use server";
import { redirect } from "next/navigation";
import { assertAdminPermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import { idParam } from "@/lib/validation";

/** Staff mark a contact message handled, or reopen it. Conditional update, so double clicks are harmless. */
export async function setMessageStatus(fd: FormData) {
  const { locale, ctx: { user: admin } } = await assertAdminPermission(fd, "messages", "edit");
  const id = idParam(fd.get("id")); const to = fd.get("to") === "new" ? "new" : "handled";
  const from = to === "handled" ? "new" : "handled";
  const r = await db.contactMessage.updateMany({ where: { id, status: from }, data: to === "handled" ? { status: "handled", handledBy: admin.id, handledAt: new Date() } : { status: "new", handledBy: null, handledAt: null } });
  if (r.count) await db.auditLog.create({ data: { actor: admin.id, action: to === "handled" ? "contact.message_handled" : "contact.message_reopened", target: id } });
  const f = fd.get("f") === "handled" ? "handled" : fd.get("f") === "all" ? "all" : "new";
  redirect(`/${locale}/admin/messages?f=${f}&msg=${to === "handled" ? "handled" : "reopened"}`);
}
