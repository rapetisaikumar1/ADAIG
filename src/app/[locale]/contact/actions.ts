"use server";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { auth } from "@/auth";
import { cleanText, emailOk, normEmail, limits } from "@/lib/validation";
import { allowContactMessage } from "@/lib/rateLimit";

// Not exported: a "use server" module may only export async functions. Keep in sync with ContactForm's TOPICS.
const contactTopics = ["membership", "enterprise", "events", "chapters", "community", "volunteering", "media", "privacy", "account", "other"] as const;
/** `field` names the input the error is about (the form marks it aria-invalid and points to the message). */
export type ContactField = "name" | "email" | "organization" | "topic" | "message" | "consent";
export type ContactState = { ok?: boolean; error?: string; field?: ContactField };

const MESSAGE_MAX = 3000;
const PER_EMAIL_PER_HOUR = 5;

/** Public contact form → ContactMessage row that staff handle in Admin → Messages. */
export async function sendContact(_: ContactState, fd: FormData): Promise<ContactState> {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const t = await getTranslations({ locale, namespace: "contact" });
  // Honeypot: real visitors never fill this hidden field. Pretend success so bots learn nothing.
  if (String(fd.get("website") ?? "").trim()) return { ok: true };
  const name = cleanText(fd.get("name"), limits.name); if (!name) return { error: t("errName"), field: "name" };
  const email = normEmail(fd.get("email")); if (!emailOk(email)) return { error: t("errEmail"), field: "email" };
  const orgRaw = String(fd.get("organization") ?? "").trim();
  const organization = orgRaw ? cleanText(orgRaw, limits.organisation) : null; if (orgRaw && !organization) return { error: t("errOrg"), field: "organization" };
  const topic = String(fd.get("topic") ?? ""); if (!(contactTopics as readonly string[]).includes(topic)) return { error: t("errTopic"), field: "topic" };
  // Keep line breaks in the message body; strip other control characters.
  const message = String(fd.get("message") ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (message.length < 10) return { error: t("errMessageShort"), field: "message" };
  if ([...message].length > MESSAGE_MAX) return { error: t("errMessageLong", { max: MESSAGE_MAX }), field: "message" };
  if (fd.get("consent") !== "on") return { error: t("errConsent"), field: "consent" };
  try { // a transient DB error returns a message instead of replacing the page, so the visitor keeps what they typed
    const recent = await db.contactMessage.count({ where: { email, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= PER_EMAIL_PER_HOUR || !(await allowContactMessage())) return { error: t("errRate") }; // + global / per-IP caps (S1-3)
    const s = await auth();
    const row = await db.contactMessage.create({ data: { name, email, organization, topic, message, locale, userId: s?.user?.id ?? null } });
    // The message is saved at this point; a failed audit row must not make the visitor send it again.
    await db.auditLog.create({ data: { actor: s?.user?.id ?? "public", action: "contact.message_received", target: row.id } }).catch((e) => console.error("contact: audit row failed", e));
  } catch (e) {
    console.error("contact: could not save message", e);
    return { error: t("errGeneric") };
  }
  return { ok: true };
}
