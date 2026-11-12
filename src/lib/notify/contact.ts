/**
 * Contact form emails (round 8, EMAIL_SPEC §2.1–2.2): contact.notify to the ADAIG inbox (Reply-To = sender) and
 * contact.ack to the sender. Called by sendContact AFTER the ContactMessage row is saved. Never throws (E2).
 * The acknowledgement never echoes the name, organization or message (anti-relay rule, spec §0.8).
 */
import { sendEmail, renderEmail, siteUrl, contactInbox } from "@/lib/email";
import { eventTimeZone } from "@/lib/time";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: eventTimeZone });
const dayTime = (d: Date) => `${day(d)} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ET`;
const L = (p: string) => siteUrl("/en" + p);

export type ContactEmailData = {
  id: string; name: string; email: string; organization: string | null;
  topicLabel: string; message: string; locale: string; userId: string | null; createdAt: Date;
};

// Email copy is English only for now (E5); add `fr` here later.
const COPY = {
  en: {
    notify: {
      subject: (topic: string) => `New contact message: ${topic}`,
      preheader: (name: string, topic: string) => `${name} wrote about ${topic} through the contact form.`,
      heading: "New contact form message",
      paragraphs: (d: ContactEmailData) => [
        `${d.name} sent a message through the contact form on the ADAIG website.`,
        `Message:\n${d.message}`,
        `Reply to this email to answer ${d.name} directly. Your reply goes to ${d.email}. Then mark the message handled in Admin → Messages.`,
      ],
      name: "Name", email: "Email", organization: "Organization", topic: "Topic",
      sentBy: "Sent by", signedIn: "Signed-in account holder", visitor: "Visitor (not signed in)",
      language: "Language", english: "English", french: "French", received: "Received",
      cta: "Open Messages",
      footerNote: "Sent to the ADAIG team inbox because a visitor used the contact form on the ADAIG website.",
    },
    ack: {
      subject: "We’ve received your message",
      preheader: "Thank you for contacting ADAIG. We aim to reply within a few business days.",
      heading: "Thank you for your message",
      paragraphs: [
        "Hello,",
        "Thank you for contacting the Association for Data and AI Governance (ADAIG). Your message has reached the ADAIG team, and we’ll reply to this email address. We aim to respond within a few business days.",
        "If you have something to add, you can reply to this email.",
      ],
      topic: "Topic", sent: "Sent",
      cta: "Read our FAQ",
      footerNote: "You received this email because this address was entered in the contact form on the ADAIG website. If you didn’t send us a message, you can ignore this email.",
    },
  },
};

const copy = (locale = "en") => COPY[locale as keyof typeof COPY] ?? COPY.en; // emails are sent in English for now (E5)

async function sendNotify(d: ContactEmailData): Promise<void> {
  try {
    const to = contactInbox();
    if (!to) return; // no association inbox configured: skip (no log row)
    const c = copy().notify;
    const { html, text } = renderEmail({
      locale: "en",
      preheader: c.preheader(d.name, d.topicLabel),
      heading: c.heading,
      paragraphs: c.paragraphs(d),
      facts: [
        { label: c.name, value: d.name },
        { label: c.email, value: d.email },
        ...(d.organization ? [{ label: c.organization, value: d.organization }] : []),
        { label: c.topic, value: d.topicLabel },
        { label: c.sentBy, value: d.userId ? c.signedIn : c.visitor },
        { label: c.language, value: d.locale === "fr" ? c.french : c.english },
        { label: c.received, value: dayTime(d.createdAt) },
      ],
      cta: { label: c.cta, url: L("/admin/messages") },
      footerNote: c.footerNote,
    });
    await sendEmail({ kind: "contact.notify", to, replyTo: d.email, subject: c.subject(d.topicLabel), html, text, dedupeKey: `contact.notify:${d.id}` });
  } catch (e) {
    console.error(`[notify] contact.notify: ${e instanceof Error ? e.name : "error"}`);
  }
}

async function sendAck(d: ContactEmailData): Promise<void> {
  try {
    const c = copy().ack;
    const { html, text } = renderEmail({
      locale: "en",
      preheader: c.preheader,
      heading: c.heading,
      paragraphs: c.paragraphs,
      facts: [
        { label: c.topic, value: d.topicLabel },
        { label: c.sent, value: dayTime(d.createdAt) },
      ],
      cta: { label: c.cta, url: L("/contact") },
      footerNote: c.footerNote,
    });
    await sendEmail({
      kind: "contact.ack", to: d.email, replyTo: contactInbox() ?? undefined, subject: c.subject, html, text,
      dedupeKey: `contact.ack:${d.id}`, userId: d.userId ?? undefined,
    });
  } catch (e) {
    console.error(`[notify] contact.ack: ${e instanceof Error ? e.name : "error"}`);
  }
}

/** Sends both contact emails in parallel. Never throws. */
export async function notifyContactMessage(d: ContactEmailData): Promise<void> {
  try {
    await Promise.all([sendNotify(d), sendAck(d)]);
  } catch {
    console.error("[notify] contact: unexpected error");
  }
}
