/**
 * Round 8 emails, contact form (EMAIL_SPEC §2.1 contact.notify, §2.2 contact.ack): verified in Mailpit (actual delivery), not
 * only in the EmailLog. Every check filters on a unique recipient (or, for the shared association inbox, a unique token in
 * the body), so it never depends on the rest of the mailbox; the mailbox is never cleared.
 * Server env (SP/serve.sh): SMTP → Mailpit, CONTACT_TO_EMAIL=info@adaig.test, CONTACT_FROM_EMAIL="ADAIG Website <info@adaig.test>",
 * NEXT_PUBLIC_SITE_URL = the app's URL. Override with E2E_CONTACT_TO_EMAIL / E2E_CONTACT_FROM_EMAIL / E2E_SITE_URL.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { count, createMember, e2eId, one, q, uniqueEmail, RUN } from "../support/db";
import { BASE_URL } from "../support/env";
import { t } from "../support/i18n";
import { expectNoEmail, getEmail, listEmails, waitForEmail, type Mail } from "../support/mail";

/* ── email helpers (same block in every email-*.spec.ts) ──────────────────────────── */
const INBOX = (process.env.E2E_CONTACT_TO_EMAIL || "info@adaig.test").toLowerCase();
const FROM = process.env.E2E_CONTACT_FROM_EMAIL || "ADAIG Website <info@adaig.test>";
const SITE = (process.env.E2E_SITE_URL || BASE_URL).replace(/\/$/, "");
const ET = "America/New_York";
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: ET });
const txt = (m: Mail) => m.text.replace(/\r\n/g, "\n");
const token = () => `Tk${RUN}${Math.random().toString(36).slice(2, 8)}`;

/** From (env), exactly one To, Reply-To, exact subject, text snippets, absolute /en links, and strings that must never appear. */
function expectMail(m: Mail, o: { to: string; replyTo: string; subject: string; text?: string[]; never?: string[] }) {
  expect(m.to, "To").toEqual([o.to.toLowerCase()]);
  expect(m.from, "From").toBe(FROM);
  expect(m.replyTo, "Reply-To").toEqual([o.replyTo.toLowerCase()]);
  expect(m.subject, "Subject").toBe(o.subject);
  for (const s of o.text ?? []) expect(txt(m), `text part contains: ${s}`).toContain(s);
  for (const s of o.never ?? []) for (const [part, v] of [["subject", m.subject], ["text", m.text], ["html", m.html]] as const)
    expect(v, `${part} must not contain: ${s}`).not.toContain(s);
  expect(m.html, "absolute /en links in the HTML").toContain(`href="${SITE}/en`);
  expect(m.html).not.toMatch(/href="\/(en|fr)\//); // no relative links
}

type LogRow = { id: string; kind: string; toEmail: string; subject: string; status: string; error: string | null; messageId: string | null; dedupeKey: string | null; userId: string | null };
const logByKey = (key: string) => one<LogRow>(`SELECT * FROM "EmailLog" WHERE "dedupeKey" = $1`, [key]);
/** The EmailLog row of a send: status "sent" (polled: the row is finished right after the SMTP answer), kind, recipient, subject. */
async function expectLogSent(key: string, o: { kind: string; to: string; subject: string; userId?: string | null }) {
  await expect.poll(async () => (await logByKey(key))?.status, { message: `EmailLog ${key}` }).toBe("sent");
  const r = (await logByKey(key))!;
  expect(r).toMatchObject({ kind: o.kind, toEmail: o.to.toLowerCase(), subject: o.subject, error: null });
  expect(r.messageId).toBeTruthy();
  if (o.userId !== undefined) expect(r.userId).toBe(o.userId);
  return r;
}

/** The newest email to the shared association inbox with this subject whose text contains `tok` (other tests write there too). */
async function waitForInboxEmail(subject: string, tok: string, timeout = 15_000): Promise<Mail> {
  const deadline = Date.now() + timeout; const seen = new Set<string>();
  for (;;) {
    for (const s of await listEmails(`to:"${INBOX}"`, 100)) {
      if (s.subject !== subject || seen.has(s.id)) continue;
      seen.add(s.id);
      const m = await getEmail(s.id);
      if (m.text.includes(tok)) return m;
    }
    if (Date.now() > deadline) throw new Error(`No "${subject}" email to ${INBOX} containing ${tok} within ${timeout} ms`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
/* ───────────────────────────────────────────────────────────────────────────────── */

type Msg = { id: string; createdAt: Date; userId: string | null };
const byToken = (tok: string) => one<Msg>(`SELECT id, "createdAt", "userId" FROM "ContactMessage" WHERE message LIKE $1`, [`%${tok}%`]);

async function fillContact(page: Page, v: { name?: string; email?: string; org?: string; topic?: string; message: string }) {
  if (v.name !== undefined) await page.locator("#cf-name").fill(v.name);
  if (v.email !== undefined) await page.locator("#cf-email").fill(v.email);
  if (v.org !== undefined) await page.locator("#cf-org").fill(v.org);
  if (v.topic) await page.locator("#cf-topic").selectOption(v.topic);
  await page.locator("#cf-msg").fill(v.message);
  await page.locator(".contact-form input[name=consent]").check();
}

test("contact form: the ADAIG inbox gets the message (Reply-To = sender, escaped) and the sender an acknowledgement without echo", async ({ page }) => {
  const tok = token();
  const name = `E2E <b>Visitor</b> ${tok.slice(-5)}`;
  const email = uniqueEmail();
  const org = `E2E Org & Partners ${tok.slice(-4)}`;
  const message = `Hello <script>alert(1)</script> & welcome ${tok}\nSecond line of the message.`;
  const topicLabel = t("contact.topic_events");

  await page.goto("/en/contact?topic=events");
  await fillContact(page, { name, email, org, message });
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator(".contact-sent")).toContainText(t("contact.sentTitle").trim());
  const row = (await byToken(tok))!;
  expect(row).toBeTruthy();

  // contact.notify → the association inbox.
  const notifySubject = `New contact message: ${topicLabel}`;
  const n = await waitForInboxEmail(notifySubject, tok);
  expectMail(n, {
    to: INBOX, replyTo: email, subject: notifySubject,
    text: [
      "New contact form message",
      `${name} sent a message through the contact form on the ADAIG website.`,
      "Message:",
      `Hello <script>alert(1)</script> & welcome ${tok}`, // the text part carries the raw text
      "Second line of the message.",
      `Reply to this email to answer ${name} directly. Your reply goes to ${email}.`,
      `Name: ${name}`, `Email: ${email}`, `Organization: ${org}`, `Topic: ${topicLabel}`,
      "Sent by: Visitor (not signed in)", "Language: English", `Received: ${day(row.createdAt)} at `,
      `Open Messages: ${SITE}/en/admin/messages`,
    ],
  });
  expect(n.subject, "no personal data in staff subjects").not.toContain(tok.slice(-5));
  // User text is HTML-escaped in the HTML part.
  expect(n.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(n.html).not.toContain("<script>alert(1)</script>");
  expect(n.html).toContain("E2E &lt;b&gt;Visitor&lt;/b&gt;");
  expect(n.html).not.toContain("<b>Visitor</b>");
  expect(n.html).toContain("E2E Org &amp; Partners");
  expect(n.html).toContain(`href="${SITE}/en/admin/messages"`);

  // contact.ack → the sender: "Hello," and no echo of the name, organization or message (anti-relay rule).
  const ackSubject = "We’ve received your message";
  const a = await waitForEmail({ to: email, subjectIncludes: ackSubject });
  expectMail(a, {
    to: email, replyTo: INBOX, subject: ackSubject,
    text: [
      "Thank you for your message", "Hello,",
      "Thank you for contacting the Association for Data and AI Governance (ADAIG). Your message has reached the ADAIG team, and we’ll reply to this email address. We aim to respond within a few business days.",
      "If you have something to add, you can reply to this email.",
      `Topic: ${topicLabel}`, `Sent: ${day(row.createdAt)} at `,
      `Read our FAQ: ${SITE}/en/contact`,
    ],
    never: [tok, tok.slice(-5), "Visitor", "Partners", "Second line of the message", "<script>"],
  });

  // One EmailLog row per send, status "sent".
  await expectLogSent(`contact.notify:${row.id}`, { kind: "contact.notify", to: INBOX, subject: notifySubject, userId: null });
  await expectLogSent(`contact.ack:${row.id}`, { kind: "contact.ack", to: email, subject: ackSubject, userId: null });
  // Exactly one acknowledgement.
  expect((await listEmails(`to:"${email}"`)).filter((m) => m.subject === ackSubject)).toHaveLength(1);
});

test("contact form: a signed-in member's notification says so and the acknowledgement is linked to the account", async ({ loginAs }) => {
  const m = await createMember();
  const p = await loginAs(m);
  const tok = token();
  await p.goto("/en/contact");
  await fillContact(p, { topic: "membership", message: `E2E member question ${tok}` });
  await p.getByRole("button", { name: t("contact.send") }).click();
  await expect(p.locator(".contact-sent")).toBeVisible();
  const row = (await byToken(tok))!;
  expect(row.userId).toBe(m.id);
  const topicLabel = t("contact.topic_membership");

  const n = await waitForInboxEmail(`New contact message: ${topicLabel}`, tok);
  expectMail(n, { to: INBOX, replyTo: m.email, subject: `New contact message: ${topicLabel}`, text: ["Sent by: Signed-in account holder", `Email: ${m.email}`] });
  const a = await waitForEmail({ to: m.email, subjectIncludes: "We’ve received your message" });
  expectMail(a, { to: m.email, replyTo: INBOX, subject: "We’ve received your message", text: [`Topic: ${topicLabel}`], never: [tok, m.name] });
  await expectLogSent(`contact.ack:${row.id}`, { kind: "contact.ack", to: m.email, subject: "We’ve received your message", userId: m.id });
});

test("contact form: honeypot hits and rate-limited submissions send no email", async ({ page }) => {
  // Honeypot: the visitor sees the success state, nothing is saved and nothing is sent.
  const bot = uniqueEmail(); const tok = token();
  await page.goto("/en/contact");
  await fillContact(page, { name: "E2E Bot", email: bot, topic: "other", message: `E2E bot ${tok}` });
  await page.locator("#cf-web").evaluate((el: HTMLInputElement) => { el.value = "https://spam.example"; });
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator(".contact-sent")).toBeVisible();
  expect(await byToken(tok)).toBeUndefined();

  // Rate limit: five earlier messages from the same address (direct rows, no email), the sixth is refused.
  const limited = uniqueEmail();
  for (let i = 0; i < 5; i++)
    await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', 'E2E earlier message', 'en')`, [e2eId(), limited]);
  const tok2 = token();
  await page.goto("/en/contact");
  await fillContact(page, { name: "E2E Sender", email: limited, topic: "other", message: `E2E sixth ${tok2}` });
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("contact.errRate"));

  expect(await expectNoEmail({ to: bot, ms: 3_000 }), "no email to the honeypot address").toBe(true);
  expect(await expectNoEmail({ to: limited, ms: 1_000 }), "no email for a rate-limited submission").toBe(true);
  expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE "toEmail" = ANY($1)`, [[bot, limited]])).toBe(0);
});
