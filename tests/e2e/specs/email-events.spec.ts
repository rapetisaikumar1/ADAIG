/**
 * Round 8 emails, events (EMAIL_SPEC §2.13 event.registered, §2.14 event.cancelled): a free registration emails once with the
 * joining details (escaped), a double submit sends one email, the mock paid checkout sends exactly one email even after a
 * reload / replay, and a staff cancellation emails confirmed registrants only (not pending, cancelled or deleted accounts).
 * Verified in Mailpit (actual delivery) and EmailLog; unique recipients, the mailbox is never cleared.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, count, createEvent, createMember, createRegistration, createUser, one, q, RUN } from "../support/db";
import { BASE_URL } from "../support/env";
import { t } from "../support/i18n";
import { expectNoEmail, listEmails, waitForEmail, type Mail } from "../support/mail";

/* ── email helpers (same block in every email-*.spec.ts) ──────────────────────────── */
const INBOX = (process.env.E2E_CONTACT_TO_EMAIL || "info@adaig.test").toLowerCase();
const FROM = process.env.E2E_CONTACT_FROM_EMAIL || "ADAIG Website <info@adaig.test>";
const SITE = (process.env.E2E_SITE_URL || BASE_URL).replace(/\/$/, "");
const ET = "America/New_York";
const txt = (m: Mail) => m.text.replace(/\r\n/g, "\n");
const token = () => `Tk${RUN}${Math.random().toString(36).slice(2, 8)}`;

function expectMail(m: Mail, o: { to: string; replyTo: string; subject: string; text?: string[]; never?: string[] }) {
  expect(m.to, "To").toEqual([o.to.toLowerCase()]);
  expect(m.from, "From").toBe(FROM);
  expect(m.replyTo, "Reply-To").toEqual([o.replyTo.toLowerCase()]);
  expect(m.subject, "Subject").toBe(o.subject);
  for (const s of o.text ?? []) expect(txt(m), `text part contains: ${s}`).toContain(s);
  for (const s of o.never ?? []) for (const [part, v] of [["subject", m.subject], ["text", m.text], ["html", m.html]] as const)
    expect(v, `${part} must not contain: ${s}`).not.toContain(s);
  expect(m.html, "absolute /en links in the HTML").toContain(`href="${SITE}/en`);
  expect(m.html).not.toMatch(/href="\/(en|fr)\//);
}

type LogRow = { id: string; kind: string; toEmail: string; subject: string; status: string; error: string | null; messageId: string | null; dedupeKey: string | null; userId: string | null };
const logsLike = (pattern: string) => q<LogRow>(`SELECT * FROM "EmailLog" WHERE "dedupeKey" LIKE $1 ORDER BY "createdAt"`, [pattern]);
const mailCount = async (to: string, subject: string) => (await listEmails(`to:"${to}"`)).filter((m) => m.to.includes(to.toLowerCase()) && m.subject === subject).length;
/* ───────────────────────────────────────────────────────────────────────────────── */

const longDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: ET });
const registered = (title: string) => `You’re registered: ${title}`;
const cancelled = (title: string) => `Event canceled: ${title}`;
const te = (k: string) => t(`adminEvents.${k}`);
const regOf = (userId: string, eventId: string) =>
  one<{ id: string; status: string; paymentRef: string | null }>(`SELECT id, status, "paymentRef" FROM "Registration" WHERE "userId" = $1 AND "eventId" = $2`, [userId, eventId]);
/** The fields of a form on the page (incl. the server action id), to replay the same submission. */
const formFields = (p: Page, selector: string) => p.locator(selector).first().evaluate((f: HTMLFormElement) =>
  Object.fromEntries(Array.from(new FormData(f).entries()).map(([k, v]) => [k, String(v)])));
const setAccessInfo = (eventId: string, info: string) => q(`UPDATE "Event" SET "accessInfo" = $2 WHERE id = $1`, [eventId, info]);

/** Wait until an email has arrived, then make sure no second one follows. */
async function expectExactlyOne(to: string, subject: string) {
  await waitForEmail({ to, subjectIncludes: subject });
  await new Promise((r) => setTimeout(r, 3_000));
  expect(await mailCount(to, subject), `exactly one "${subject}" to ${to}`).toBe(1);
}

test("free registration: confirmation with escaped joining details and CPE; a replayed submission sends nothing more", async ({ loginAs }) => {
  const tok = token();
  const m = await createMember();
  const e = await createEvent({ title: `E2E Free & Open ${tok}`, memberPriceCents: 0, publicPriceCents: 4900, cpe: 1.5 });
  await setAccessInfo(e.id, `Join on Zoom: https://zoom.example.com/j/${tok}\nPasscode: <4321> & more`);
  const p = await loginAs(m);
  await p.goto(`/en/events/${e.slug}`);
  const fields = await formFields(p, ".ev-reg form");
  await p.getByRole("button", { name: t("events.registerFree") }).click();
  await expect(p).toHaveURL(/registered=1/);
  const r = (await regOf(m.id, e.id))!;
  const [audit] = await auditRows({ action: "event.registered_free", target: r.id });

  const mail = await waitForEmail({ to: m.email, subjectIncludes: registered(e.title) });
  expectMail(mail, {
    to: m.email, replyTo: INBOX, subject: registered(e.title),
    text: [
      "You’re registered", "Hello,",
      `Your seat for ${e.title} is confirmed. The event details are below, and you can find them at any time under My events.`,
      "How to join (for registered attendees only, please don’t share):",
      `Join on Zoom: https://zoom.example.com/j/${tok}`, "Passcode: <4321> & more",
      "This session carries 1.5 CPE credit. CPE credit is recorded in your ADAIG account once your attendance is confirmed.",
      `Event: ${e.title}`, `Date: ${longDate(e.startsAt)}`, "Time: ", "Format: Online", "Ticket: Member ticket · Free",
      `View My events: ${SITE}/en/my/events`,
    ],
    never: [m.password, m.name],
  });
  expect(mail.html).toContain("Passcode: &lt;4321&gt; &amp; more");
  expect(mail.html).not.toContain("<4321>");
  expect(mail.html).toContain("E2E Free &amp; Open");
  const logs = await logsLike(`event.registered:${r.id}:%`);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ dedupeKey: `event.registered:${r.id}:${audit.id}`, kind: "event.registered", toEmail: m.email, status: "sent", userId: m.id, subject: registered(e.title) });
  expect(logs[0].messageId).toBeTruthy();

  // Replaying the same submission (double submit after the first completed): no new registration, no second email.
  const replay = await p.request.post(`/en/events/${e.slug}`, { multipart: fields, maxRedirects: 0 });
  expect(replay.status()).toBeLessThan(500);
  await expectExactlyOne(m.email, registered(e.title));
  expect(await logsLike(`event.registered:${r.id}:%`)).toHaveLength(1);
  expect(await auditRows({ action: "event.registered_free", target: r.id })).toHaveLength(1);
});

test("free registration: two concurrent submits make one registration and one email; no joining details yet, no CPE line", async ({ loginAs }) => {
  const tok = token();
  const m = await createMember();
  const e = await createEvent({ title: `E2E Double ${tok}`, memberPriceCents: 0, cpe: 0 });
  const p = await loginAs(m);
  await p.goto(`/en/events/${e.slug}`);
  const fields = await formFields(p, ".ev-reg form");
  const res = await Promise.all([0, 1].map(() => p.request.post(`/en/events/${e.slug}`, { multipart: fields, maxRedirects: 0 })));
  for (const x of res) expect(x.status()).toBeLessThan(500);
  expect(await count(`SELECT count(*) AS n FROM "Registration" WHERE "userId" = $1 AND "eventId" = $2`, [m.id, e.id])).toBe(1);
  const r = (await regOf(m.id, e.id))!;
  expect(r.status).toBe("confirmed");

  await expectExactlyOne(m.email, registered(e.title));
  const mail = await waitForEmail({ to: m.email, subjectIncludes: registered(e.title) });
  expectMail(mail, {
    to: m.email, replyTo: INBOX, subject: registered(e.title),
    text: ["Joining details (such as the webinar link or venue instructions) will appear under My events once the ADAIG team adds them.", "Ticket: Member ticket · Free"],
    never: ["How to join", "CPE credit", "we’ll email", m.password],
  });
  const logs = await logsLike(`event.registered:${r.id}:%`);
  expect(logs).toHaveLength(1);
  expect(logs[0].status).toBe("sent");
});

test("paid ticket (mock checkout): exactly one confirmation, also after a reload, a replay and a revisit of the checkout", async ({ loginAs }) => {
  const tok = token();
  const g = await createUser({ role: "guest" });
  const e = await createEvent({ title: `E2E Paid ${tok}`, memberPriceCents: 0, publicPriceCents: 2500, cpe: 1 });
  await setAccessInfo(e.id, `Join on Teams: https://teams.example.com/${tok}`);
  const p = await loginAs(g);
  await p.goto(`/en/events/${e.slug}`);
  await p.getByRole("button", { name: new RegExp(`${t("events.payAndRegister")}.*25`) }).click();
  await expect(p).toHaveURL(new RegExp(`/en/events/${e.slug}/checkout\\?r=`));
  const pay = p.getByRole("button", { name: new RegExp(t("events.payMock")) });
  test.skip((await pay.count()) === 0, "mock payments are not enabled on this server (ALLOW_MOCK_PAYMENTS, no Stripe key)");
  expect(await mailCount(g.email, registered(e.title)), "nothing before payment").toBe(0);
  const fields = await formFields(p, ".ev-checkout form");
  await pay.click();
  await expect(p).toHaveURL(new RegExp(`/en/events/${e.slug}\\?registered=1`));
  const r = (await regOf(g.id, e.id))!;
  expect(r.status).toBe("confirmed");
  expect(r.paymentRef).toMatch(/^mock_/);

  const mail = await waitForEmail({ to: g.email, subjectIncludes: registered(e.title) });
  expectMail(mail, {
    to: g.email, replyTo: INBOX, subject: registered(e.title),
    text: ["Hello,", "How to join (for registered attendees only, please don’t share):", `Join on Teams: https://teams.example.com/${tok}`, `Event: ${e.title}`],
    never: [g.password],
  });
  expect(txt(mail)).toMatch(/Ticket: Non-member ticket · \S*25\.00 paid/);

  await p.reload();
  await p.request.post(`/en/events/${e.slug}/checkout?r=${r.id}`, { multipart: fields, maxRedirects: 0 });
  await p.goto(`/en/events/${e.slug}/checkout?r=${r.id}`);
  await expectExactlyOne(g.email, registered(e.title));
  const logs = await logsLike(`event.registered:${r.id}:%`);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ dedupeKey: `event.registered:${r.id}:${r.paymentRef}`, status: "sent", toEmail: g.email, userId: g.id });
});

test("event canceled by staff: confirmed registrants are emailed (refund line when paid); pending, cancelled and deleted are not", async ({ adminPage }) => {
  const tok = token();
  const e = await createEvent({ title: `E2E Cancel & Notify ${tok}`, memberPriceCents: 0, publicPriceCents: 2500 });
  const free = await createMember();
  const paid = await createUser({ role: "guest" });
  const pending = await createUser({ role: "guest" });
  const gone = await createUser({ role: "guest" });
  const deleted = await createUser({ role: "guest" });
  const freeReg = await createRegistration(free.id, e.id, { ticket: "member", amountCents: 0 });
  const paidReg = await createRegistration(paid.id, e.id, { ticket: "non-member", amountCents: 2500 });
  const pendingReg = await createRegistration(pending.id, e.id, { ticket: "non-member", amountCents: 2500, status: "pending_payment" });
  const goneReg = await createRegistration(gone.id, e.id, { ticket: "non-member", amountCents: 0, status: "cancelled" });
  const deletedReg = await createRegistration(deleted.id, e.id, { ticket: "member", amountCents: 0 });
  await q(`UPDATE "User" SET role = 'deleted' WHERE id = $1`, [deleted.id]); // keeps its e2e address so a stray email would show

  await adminPage.goto(`/en/admin/events/${e.id}`);
  await adminPage.locator("#danger summary", { hasText: te("cancelBtn") }).click();
  await adminPage.getByRole("button", { name: te("cancelYes") }).click();
  await expect(adminPage).toHaveURL(/msg=cancelled/);
  await expect(adminPage.locator("main .alert").first()).toHaveText(te("msg_cancelled"));

  const subject = cancelled(e.title);
  const planned = `We’re sorry to let you know that ${e.title}, planned for ${longDate(e.startsAt)} at `;
  const common = ["This event has been canceled", planned, "Thank you for your interest. You can browse other upcoming ADAIG events on our website.",
    `Event: ${e.title}`, `Was planned for: ${longDate(e.startsAt)} · `, `Browse upcoming events: ${SITE}/en/events`];

  const mf = await waitForEmail({ to: free.email, subjectIncludes: subject });
  expectMail(mf, { to: free.email, replyTo: INBOX, subject, text: [`Hello ${free.name},`, ...common, "There’s nothing you need to do.", "Ticket: Member ticket"], never: ["/en/my/events", "refund"] });
  expect(mf.html).toContain("E2E Cancel &amp; Notify");

  const mp = await waitForEmail({ to: paid.email, subjectIncludes: subject });
  expectMail(mp, { to: paid.email, replyTo: INBOX, subject, text: [`Hello ${paid.name},`, ...common], never: ["/en/my/events", "There’s nothing you need to do."] });
  expect(txt(mp)).toMatch(/You paid \S*25\.00 for your ticket\. The ADAIG team will refund your payment\./);
  expect(txt(mp)).toMatch(/Ticket: Non-member ticket · \S*25\.00 paid/);

  for (const [reg, to] of [[freeReg, free.email], [paidReg, paid.email]] as const) {
    const logs = await logsLike(`event.cancelled:${reg}:%`);
    expect(logs, to).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: "event.cancelled", toEmail: to, status: "sent", subject });
  }
  for (const u of [pending, gone, deleted]) expect(await expectNoEmail({ to: u.email, subjectIncludes: subject, ms: 1_500 }), u.email).toBe(true);
  for (const reg of [pendingReg, goneReg, deletedReg]) expect(await logsLike(`event.cancelled:${reg}:%`)).toHaveLength(0);
  expect(await mailCount(free.email, subject)).toBe(1);
  expect(await mailCount(paid.email, subject)).toBe(1);
});
