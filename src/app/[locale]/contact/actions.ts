"use server";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { auth } from "@/auth";
import { cleanText, emailOk, normEmail, limits } from "@/lib/validation";

// Not exported: a "use server" module may only export async functions. Keep in sync with ContactForm's TOPICS.
const contactTopics = ["membership", "enterprise", "events", "chapters", "community", "volunteering", "media", "privacy", "account", "other"] as const;
export type ContactState = { ok?: boolean; error?: string };

const MESSAGE_MAX = 3000;
const PER_EMAIL_PER_HOUR = 5;

/** Public contact form → ContactMessage row that staff handle in Admin → Messages. */
export async function sendContact(_: ContactState, fd: FormData): Promise<ContactState> {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const t = await getTranslations({ locale, namespace: "contact" });
  // Honeypot: real visitors never fill this hidden field. Pretend success so bots learn nothing.
  if (String(fd.get("website") ?? "").trim()) return { ok: true };
  const name = cleanText(fd.get("name"), limits.name); if (!name) return { error: t("errName") };
  const email = normEmail(fd.get("email")); if (!emailOk(email)) return { error: t("errEmail") };
  const orgRaw = String(fd.get("organization") ?? "").trim();
  const organization = orgRaw ? cleanText(orgRaw, limits.organisation) : null; if (orgRaw && !organization) return { error: t("errOrg") };
  const topic = String(fd.get("topic") ?? ""); if (!(contactTopics as readonly string[]).includes(topic)) return { error: t("errTopic") };
  // Keep line breaks in the message body; strip other control characters.
  const message = String(fd.get("message") ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (message.length < 10) return { error: t("errMessageShort") };
  if ([...message].length > MESSAGE_MAX) return { error: t("errMessageLong", { max: MESSAGE_MAX }) };
  if (fd.get("consent") !== "on") return { error: t("errConsent") };
  const recent = await db.contactMessage.count({ where: { email, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= PER_EMAIL_PER_HOUR) return { error: t("errRate") };
  const s = await auth();
  const row = await db.contactMessage.create({ data: { name, email, organization, topic, message, locale, userId: s?.user?.id ?? null } });
  await db.auditLog.create({ data: { actor: s?.user?.id ?? "public", action: "contact.message_received", target: row.id } });
  return { ok: true };
}
