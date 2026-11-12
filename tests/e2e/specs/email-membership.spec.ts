/**
 * Round 8 emails, membership (EMAIL_SPEC §2.3–2.6, §2.15–2.16): join.ack + join.notify, membership.approved / .rejected
 * (with the staff reason), and the daily cron's membership.renewal_due / membership.lapsed with the coordinator's windows
 * (WAVE8 Phase 2, Q3: a reminder only when the renewal date passed within the last 14 days; a lapse notice only for
 * membership.lapsed_auto rows from the last 7 days; staff-marked lapses are never emailed). A re-run sends nothing again.
 * Verified in Mailpit (actual delivery) and in EmailLog. The mailbox is never cleared: unique recipients, or a unique token
 * in the body for the shared association inbox.
 * The cron tests call GET /api/cron/expire-unpaid-orders with `Authorization: Bearer <secret>`: start the app with
 * CRON_SECRET=<value> and run the suite with E2E_CRON_SECRET=<same value> (or CRON_SECRET). Without it they are skipped.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, count, createMembership, createUser, e2eId, membershipsOf, one, q, userByEmail, userById, uniqueEmail, uniquePassword, RUN } from "../support/db";
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
const logByKey = (key: string) => one<LogRow>(`SELECT * FROM "EmailLog" WHERE "dedupeKey" = $1`, [key]);
async function expectLogSent(key: string, o: { kind: string; to: string; subject: string; userId?: string | null }) {
  await expect.poll(async () => (await logByKey(key))?.status, { message: `EmailLog ${key}` }).toBe("sent");
  const r = (await logByKey(key))!;
  expect(r).toMatchObject({ kind: o.kind, toEmail: o.to.toLowerCase(), subject: o.subject, error: null });
  expect(r.messageId).toBeTruthy();
  if (o.userId !== undefined) expect(r.userId).toBe(o.userId);
  return r;
}
const logsLike = (pattern: string) => q<LogRow>(`SELECT * FROM "EmailLog" WHERE "dedupeKey" LIKE $1 ORDER BY "createdAt"`, [pattern]);
const mailCount = async (to: string, subject: string) => (await listEmails(`to:"${to}"`)).filter((m) => m.to.includes(to.toLowerCase()) && m.subject === subject).length;

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

const ACK = "We’ve received your ADAIG membership application";
const APPROVED = "Welcome to ADAIG: your membership is active";
const REJECTED = "Update on your ADAIG membership application";
const RENEWAL = "Your ADAIG membership is due for renewal";
const LAPSED = "Your ADAIG membership has lapsed";

type Applicant = { first: string; last: string; email: string; password: string; org: string };
const applicant = (): Applicant => {
  const tok = token();
  return { first: "E2E", last: `Applicant ${tok}`, email: uniqueEmail(), password: uniquePassword(), org: `E2E Applicants & <Partners> ${tok.slice(-4)}` };
};

async function fillApplication(page: Page, a: Applicant, opts: { tier: string; institution?: string; signedIn?: boolean }) {
  await page.goto(`/en/join?tier=${opts.tier}`);
  await expect(page.locator("#tier")).toHaveValue(opts.tier);
  await page.locator("#fn").fill(a.first);
  await page.locator("#ln").fill(a.last);
  await page.locator("#org").fill(a.org);
  await page.locator("#co").selectOption("United States");
  await page.locator("#pr").selectOption("NY");
  if (opts.institution) {
    await page.locator("#inst").fill(opts.institution);
    await page.locator("input[name=eligibilityAttest]").check();
  }
  if (!opts.signedIn) {
    await page.locator("#em").fill(a.email);
    await page.locator("#pw").fill(a.password);
  }
}
const membershipDates = (id: string) => one<{ startsAt: Date; renewsAt: Date; createdAt: Date }>(`SELECT "startsAt", "renewsAt", "createdAt" FROM "Membership" WHERE id = $1`, [id]);

test("join (new account): acknowledgement to the applicant, notification to the inbox; approval emails a welcome", async ({ page, adminPage }) => {
  const a = applicant(); const name = `${a.first} ${a.last}`;
  await fillApplication(page, a, { tier: "professional" });
  await page.getByRole("button", { name: t("join.submit") }).click();
  await expect(page).toHaveURL(/\/en\/my\/billing\?applied=1$/);
  const u = (await userByEmail(a.email))!;
  const [m] = await membershipsOf(u.id);
  const created = (await membershipDates(m.id))!.createdAt;

  // join.ack → applicant: "Hello," (no name, no organization: anti-relay), new-account paragraph, no student paragraph, no password.
  const ack = await waitForEmail({ to: a.email, subjectIncludes: ACK });
  expectMail(ack, {
    to: a.email, replyTo: INBOX, subject: ACK,
    text: [
      "Thank you for applying", "Hello,",
      "Thank you for applying for Professional membership with the Association for Data and AI Governance (ADAIG). We’ve received your application.",
      "The ADAIG team reviews every application. A member of our team, your point of contact (POC), will then contact you",
      "Nothing has been charged: there is no payment when you apply.",
      "We’ve also created your ADAIG account. Sign in with this email address and the password you chose to follow your application.",
      "Tier: Professional", "Status: Under review", `Submitted: ${day(created)}`, `Account email: ${a.email}`,
      `View My membership: ${SITE}/en/my/billing`,
    ],
    never: [a.password, a.last, "Partners", "proof of enrollment"],
  });

  // join.notify → the association inbox (Reply-To = applicant), user text escaped in the HTML, no password.
  const notifySubject = "New membership application: Professional";
  const n = await waitForInboxEmail(notifySubject, a.last);
  expectMail(n, {
    to: INBOX, replyTo: a.email, subject: notifySubject,
    text: [
      "New membership application",
      `${name} applied for Professional membership. The application is waiting for review in Admin → Members.`,
      `Name: ${name}`, `Email: ${a.email}`, "Tier: Professional", `Organization: ${a.org}`, "Country: United States",
      "Account: New account created with this application", `Submitted: ${day(created)} at `,
      `Review the application: ${SITE}/en/admin/members/${encodeURIComponent(u.id)}#memberships`,
    ],
    never: [a.password],
  });
  expect(n.subject).not.toContain(a.last);
  expect(n.html).toContain("E2E Applicants &amp; &lt;Partners&gt;");
  expect(n.html).not.toContain("<Partners>");
  expect(txt(n)).not.toContain("Institution:"); // only for tiers that require verification

  await expectLogSent(`join.ack:${m.id}`, { kind: "join.ack", to: a.email, subject: ACK, userId: u.id });
  await expectLogSent(`join.notify:${m.id}`, { kind: "join.notify", to: INBOX, subject: notifySubject, userId: null });

  // Approve → membership.approved ("Hello {name},", tier, dates, My membership).
  await adminPage.goto(`/en/admin/members?f=pending&q=${encodeURIComponent(a.email)}`);
  await adminPage.locator("tbody tr", { hasText: a.email }).getByRole("button", { name: `${t("admin.approve")}: ${name}` }).click();
  await expect(adminPage).toHaveURL(/msg=approved/);
  const d = (await membershipDates(m.id))!;
  const w = await waitForEmail({ to: a.email, subjectIncludes: APPROVED });
  expectMail(w, {
    to: a.email, replyTo: INBOX, subject: APPROVED,
    text: [
      "Your membership is active", `Hello ${name},`,
      "Welcome to the Association for Data and AI Governance (ADAIG). Your application has been approved, and your Professional membership is now active.",
      "Membership fees aren’t paid online.",
      "Tier: Professional", "Status: Active", `Member since: ${day(d.startsAt)}`, `Renewal date: ${day(d.renewsAt)}`,
      `Go to My membership: ${SITE}/en/my/billing`,
    ],
    never: [a.password],
  });
  expect(w.subject).not.toContain(a.last); // member subjects never carry the name
  await expectLogSent(`membership.approved:${m.id}`, { kind: "membership.approved", to: a.email, subject: APPROVED, userId: u.id });
  expect(await mailCount(a.email, ACK)).toBe(1);
  expect(await mailCount(a.email, APPROVED)).toBe(1);
});

test("join (student): the acknowledgement mentions eligibility; a rejection emails the escaped staff reason", async ({ page, adminPage }) => {
  const a = applicant(); const name = `${a.first} ${a.last}`;
  const reason = `E2E reason ${RUN} <not html> & co`;
  await fillApplication(page, a, { tier: "student", institution: "E2E University & College" });
  await page.getByRole("button", { name: t("join.submit") }).click();
  await expect(page).toHaveURL(/applied=1/);
  const u = (await userByEmail(a.email))!;
  const [m] = await membershipsOf(u.id);

  const ack = await waitForEmail({ to: a.email, subjectIncludes: ACK });
  expectMail(ack, {
    to: a.email, replyTo: INBOX, subject: ACK,
    text: ["Thank you for applying for Student membership", "Our team confirms student eligibility as part of reviewing your application and may ask you for proof of enrollment.", "Tier: Student"],
    never: [a.password, "E2E University"],
  });
  const n = await waitForInboxEmail("New membership application: Student", a.last);
  expectMail(n, { to: INBOX, replyTo: a.email, subject: "New membership application: Student", text: ["Institution: E2E University & College"] });
  expect(n.html).toContain("E2E University &amp; College");

  await adminPage.goto(`/en/admin/members/${u.id}`);
  await adminPage.locator("#memberships summary", { hasText: t("admin.reject") }).click();
  await adminPage.locator(`#rr-${m.id}`).fill(reason);
  await adminPage.getByRole("button", { name: t("admin.confirmReject") }).click();
  await expect(adminPage).toHaveURL(/msg=msg_rejected/);

  const r = await waitForEmail({ to: a.email, subjectIncludes: REJECTED });
  const created = (await membershipDates(m.id))!.createdAt;
  expectMail(r, {
    to: a.email, replyTo: INBOX, subject: REJECTED,
    text: [
      "Your application wasn’t approved", `Hello ${name},`,
      "After reviewing your application for Student membership, the ADAIG team wasn’t able to approve it.",
      `Reason: ${reason}.`,
      "Your ADAIG account stays open as a free account.",
      "Tier: Student", "Status: Not approved", `Applied on: ${day(created)}`,
      `View My membership: ${SITE}/en/my/billing`,
    ],
    never: [a.password],
  });
  expect(r.html).toContain("&lt;not html&gt; &amp; co");
  expect(r.html).not.toContain("<not html>");
  await expectLogSent(`membership.rejected:${m.id}`, { kind: "membership.rejected", to: a.email, subject: REJECTED, userId: u.id });
  expect(await mailCount(a.email, APPROVED)).toBe(0);
});

test("join (signed-in account): the acknowledgement has no new-account paragraph and the inbox sees an existing account", async ({ loginAs }) => {
  const u = await createUser({ role: "guest" });
  const p = await loginAs(u);
  const a = { ...applicant(), email: u.email, password: u.password };
  await fillApplication(p, a, { tier: "professional", signedIn: true });
  await p.getByRole("button", { name: t("join.submit") }).click();
  await expect(p).toHaveURL(/applied=1/);
  const [m] = await membershipsOf(u.id);

  const ack = await waitForEmail({ to: u.email, subjectIncludes: ACK });
  expectMail(ack, { to: u.email, replyTo: INBOX, subject: ACK, text: [`Account email: ${u.email}`], never: ["We’ve also created your ADAIG account", u.password] });
  const n = await waitForInboxEmail("New membership application: Professional", a.last);
  expectMail(n, { to: INBOX, replyTo: u.email, subject: "New membership application: Professional", text: ["Account: Existing account"] });
  await expectLogSent(`join.ack:${m.id}`, { kind: "join.ack", to: u.email, subject: ACK, userId: u.id });
});

/* ── daily cron: renewal reminders and lapse notices ───────────────────────────────── */

const CRON_SECRET = (process.env.E2E_CRON_SECRET || process.env.CRON_SECRET || "").trim();
type Counts = { sent: number; failed: number; skipped: number; duplicate: number };
async function runCron(request: APIRequestContext) {
  const r = await request.get("/api/cron/expire-unpaid-orders", { headers: { authorization: `Bearer ${CRON_SECRET}` }, timeout: 90_000 });
  expect(r.status(), "cron run").toBe(200);
  const body = (await r.json()) as { ok: boolean; emails: { renewalDue: Counts; lapsed: Counts } | null; resetTokensPruned: number };
  expect(body.ok).toBe(true);
  expect(body.emails, "the email step ran without throwing").toBeTruthy();
  for (const k of ["renewalDue", "lapsed"] as const)
    expect(body.emails![k]).toEqual(expect.objectContaining({ sent: expect.any(Number), failed: expect.any(Number), skipped: expect.any(Number), duplicate: expect.any(Number) }));
  expect(typeof body.resetTokensPruned).toBe("number");
  return body;
}
const ago = (days: number) => new Date(Date.now() - days * 864e5);
async function memberWith(renewsAt: Date) {
  const u = await createUser({ role: "member" });
  const membershipId = await createMembership(u.id, { renewsAt });
  return { ...u, membershipId, renewsAt };
}
/** A membership already lapsed (closed row) with a `membership.lapsed_auto` (or other) audit row `daysAgo` days old. */
async function lapsedWithAudit(daysAgo: number, action = "membership.lapsed_auto") {
  const u = await createUser({ role: "guest" });
  const membershipId = await createMembership(u.id, { status: "lapsed" });
  const renewsAt = ago(daysAgo + 31);
  await q(`UPDATE "Membership" SET "startsAt" = $2, "renewsAt" = $3 WHERE id = $1`, [membershipId, ago(daysAgo + 400), renewsAt]);
  const auditId = e2eId(); const lapsedAt = ago(daysAgo);
  await q(`INSERT INTO "AuditLog" (id, actor, action, target, "createdAt") VALUES ($1, 'system', $2, $3, $4)`, [auditId, action, membershipId, lapsedAt]);
  return { ...u, membershipId, renewsAt, auditId, lapsedAt };
}

test.describe("daily cron emails", () => {
  test.skip(!CRON_SECRET, "set E2E_CRON_SECRET (the app's CRON_SECRET) to run the cron email tests");

  test("renewal_due: only when the renewal date passed within the last 14 days, once per period (a re-run sends nothing)", async ({ request }) => {
    test.setTimeout(180_000);
    const due = await memberWith(ago(3));       // passed 3 days ago → one reminder
    const old = await memberWith(ago(20));      // in the 30-day grace period but older than 14 days → no reminder (Q3: no backlog)
    const future = await memberWith(new Date(Date.now() + 5 * 864e5)); // not yet due → nothing before the date
    const before = await auditRows({ action: "system.cron_expire_unpaid_orders" });

    await runCron(request);
    expect((await auditRows({ action: "system.cron_expire_unpaid_orders" })).length).toBeGreaterThan(before.length);
    expect((await auditRows({ action: "system.cron_expire_unpaid_orders" }))[0].target).toMatch(/^expired:\d+$/); // format unchanged

    const lapseOn = new Date(+due.renewsAt + 30 * 864e5);
    const m = await waitForEmail({ to: due.email, subjectIncludes: RENEWAL });
    expectMail(m, {
      to: due.email, replyTo: INBOX, subject: RENEWAL,
      text: [
        "Your membership is due for renewal", `Hello ${due.name},`,
        `Your Professional membership was due for renewal on ${day(due.renewsAt)}. Renewal isn’t handled online: the ADAIG team will contact you about renewing.`,
        `Your membership stays active during a 30-day grace period. If it isn’t renewed by ${day(lapseOn)}, it will lapse.`,
        "Tier: Professional", `Renewal date: ${day(due.renewsAt)}`, `Grace period ends: ${day(lapseOn)}`,
        `Go to My membership: ${SITE}/en/my/billing`,
      ],
    });
    const [row] = await logsLike(`membership.renewal_due:${due.membershipId}:%`);
    expect(row).toMatchObject({ kind: "membership.renewal_due", toEmail: due.email, status: "sent", userId: due.id, subject: RENEWAL });

    expect(await expectNoEmail({ to: old.email, ms: 2_000 }), "no reminder older than 14 days").toBe(true);
    expect(await expectNoEmail({ to: future.email, ms: 500 }), "no reminder before the renewal date").toBe(true);
    expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE "userId" = ANY($1)`, [[old.id, future.id]])).toBe(0);
    expect((await membershipsOf(due.id))[0].status).toBe("active"); // a reminder changes nothing

    // Re-run: no second reminder.
    await runCron(request);
    await new Promise((r) => setTimeout(r, 2_000));
    expect(await mailCount(due.email, RENEWAL)).toBe(1);
    expect(await logsLike(`membership.renewal_due:${due.membershipId}:%`)).toHaveLength(1);
  });

  test("lapsed: the cron's own lapse and lapses from the last 7 days are emailed once; older and staff-marked lapses are not", async ({ request }) => {
    test.setTimeout(180_000);
    const overdue = await memberWith(ago(31));                       // lapsed by this cron run → notice in the same run
    const recent = await lapsedWithAudit(2);                         // lapsed lazily 2 days ago → notice
    const stale = await lapsedWithAudit(8);                          // lapsed 8 days ago → outside the 7-day window
    const staff = await lapsedWithAudit(1, "membership.marked_lapsed"); // marked lapsed by staff → never emailed

    await runCron(request);
    expect((await membershipsOf(overdue.id))[0].status).toBe("lapsed");
    expect((await userById(overdue.id))!.role).toBe("guest");
    const [lapseAudit] = await auditRows({ action: "membership.lapsed_auto", target: overdue.membershipId });
    expect(lapseAudit).toBeTruthy();
    const lapsedAt = (await one<{ createdAt: Date }>(`SELECT "createdAt" FROM "AuditLog" WHERE id = $1`, [lapseAudit.id]))!.createdAt;

    for (const [who, at, key] of [[overdue, lapsedAt, lapseAudit.id], [recent, recent.lapsedAt, recent.auditId]] as const) {
      const m = await waitForEmail({ to: who.email, subjectIncludes: LAPSED });
      expectMail(m, {
        to: who.email, replyTo: INBOX, subject: LAPSED,
        text: [
          "Your membership has lapsed", `Hello ${who.name},`,
          `Your Professional membership lapsed on ${day(at)} because it wasn’t renewed by the end of the grace period.`,
          "Your ADAIG account stays open as a free guest account", // both are guests now
          "The ADAIG team can renew your membership for you.",
          "Tier: Professional", "Status: Lapsed", `Renewal was due: ${day(who.renewsAt)}`,
          `Contact the ADAIG team: ${SITE}/en/contact?topic=membership`,
        ],
      });
      await expectLogSent(`membership.lapsed:${key}`, { kind: "membership.lapsed", to: who.email, subject: LAPSED, userId: who.id });
    }
    expect(await expectNoEmail({ to: stale.email, ms: 2_000 }), "no notice for a lapse older than 7 days").toBe(true);
    expect(await expectNoEmail({ to: staff.email, ms: 500 }), "no notice for a staff-marked lapse").toBe(true);
    expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE "userId" = ANY($1)`, [[stale.id, staff.id]])).toBe(0);
    // A member whose membership lapsed is never sent a renewal reminder in the same run.
    expect(await mailCount(overdue.email, RENEWAL)).toBe(0);

    // Re-run: nothing again.
    await runCron(request);
    await new Promise((r) => setTimeout(r, 2_000));
    expect(await mailCount(overdue.email, LAPSED)).toBe(1);
    expect(await mailCount(recent.email, LAPSED)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE kind = 'membership.lapsed' AND "userId" = ANY($1)`, [[overdue.id, recent.id]])).toBe(2);
  });
});
