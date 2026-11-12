/**
 * Round 8 email security fixes (SP/r8/SEC-R8.md):
 *  - M1 per-address limits count x+tag@d as x@d (contact form, forgot password); the send budget for emails to visitor-typed
 *    addresses (contact.ack, signup.welcome, join.ack, password.reset_link): 3 per recipient per hour, and a total per hour
 *    (EMAIL_UNVERIFIED_HOURLY_CAP). Over budget → EmailLog "skipped" / "budget", nothing in Mailpit, the business row is saved
 *    and the visitor sees the usual answer.
 *  - M2 scripts/check-env.mjs fails the build for a non-https NEXT_PUBLIC_SITE_URL or one whose host differs from APP_URL's.
 *  - L4 addresses are redacted from SMTP error text, and account deletion scrubs them from EmailLog.error.
 * (L3, reset links deleted on deactivation: email-accounts.spec.ts. L2, cron prune of pr:/pi: buckets: admin-ops.spec.ts.)
 *
 * The total-per-hour test inserts E2E_EMAIL_UNVERIFIED_HOURLY_CAP (default 1000) synthetic "sent" rows for one moment, so it
 * works against any server whose EMAIL_UNVERIFIED_HOURLY_CAP is at most that (the default is 60; SP/serve.sh uses 1000).
 */
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { count, createMember, createUser, e2eId, one, q, uniqueEmail, RUN } from "../support/db";
import { APP_DIR } from "../support/env";
import { t } from "../support/i18n";
import { expectNoEmail, waitForEmail } from "../support/mail";
import { describeError } from "../../../src/lib/email/transport";
import { redactAddresses, siteUrl } from "../../../src/lib/email/config";

type LogRow = { id: string; kind: string; toEmail: string; status: string; error: string | null; messageId: string | null; userId: string | null };
const logByKey = (key: string) => one<LogRow>(`SELECT * FROM "EmailLog" WHERE "dedupeKey" = $1`, [key]);
const token = () => `Tk${RUN}${Math.random().toString(36).slice(2, 8)}`;
/** The same mailbox under another "+tag" (x@d → x+tag@d). */
const tagged = (email: string, tag: string) => email.replace("@", `+${tag}@`);
const ACK = "We’ve received your message";
const RESET_LINK = "Reset your ADAIG password";

async function sendContact(page: Page, email: string, message: string) {
  await page.goto("/en/contact");
  await page.locator("#cf-name").fill("E2E Budget Visitor");
  await page.locator("#cf-email").fill(email);
  await page.locator("#cf-topic").selectOption("other");
  await page.locator("#cf-msg").fill(message);
  await page.locator(".contact-form input[name=consent]").check();
  await page.getByRole("button", { name: t("contact.send") }).click();
}
const messageByToken = (tok: string) => one<{ id: string; email: string }>(`SELECT id, email FROM "ContactMessage" WHERE message LIKE $1`, [`%${tok}%`]);

async function requestReset(p: Page, email: string) {
  await p.goto("/en/forgot-password");
  await p.locator("main form input[name=email]").fill(email);
  await p.locator("main form").getByRole("button", { name: t("auth.forgotSubmit") }).click();
}
const expectSentState = (p: Page) => expect(p.locator("main").getByRole("status")).toContainText(t("auth.forgotSentTitle"));

/* ── M1: "+tag" variants share the per-address limits ─────────────────────────────── */

test("per-address limits count x+tag@ as x@: the contact form and forgot password refuse +tag variants over the limit", async ({ page }) => {
  // Contact form: 5 messages from x@ this hour (direct rows, no email); X+tag@ (other case too) is refused like x@ itself.
  const base = uniqueEmail();
  for (let i = 0; i < 5; i++)
    await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', 'E2E earlier message', 'en')`, [e2eId(), base]);
  const tok = token();
  const variant = tagged(base, "bypass1").toUpperCase();
  await sendContact(page, variant, `E2E tag bypass ${tok}`);
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("contact.errRate"));
  expect(await messageByToken(tok), "nothing saved").toBeUndefined();
  expect(await expectNoEmail({ to: variant.toLowerCase(), ms: 2_000 })).toBe(true);

  // Forgot password: 3 requests per address per hour, counted across +tag variants and case.
  const addr = uniqueEmail();
  for (const v of [tagged(addr, "a"), tagged(addr, "b").toUpperCase(), addr]) { await requestReset(page, v); await expectSentState(page); }
  await requestReset(page, tagged(addr, "c"));
  await expect(page.locator("main").getByRole("alert")).toContainText(t("auth.forgotErrRate"));
  const [k] = addr.split("@");
  expect(await count(`SELECT count(*) AS n FROM "LoginThrottle" WHERE key LIKE $1`, [`pr:${k}+%`]), "one bucket per address key, no +tag buckets").toBe(0);
  expect(await count(`SELECT count(*) AS n FROM "LoginThrottle" WHERE key = $1 AND failures = 4`, [`pr:${addr}`])).toBe(1);
});

/* ── M1: send budget ───────────────────────────────────────────────────────────── */

test("send budget: the 4th visitor-typed email to one person in an hour is skipped (skipped/budget); the message is saved and staff are notified", async ({ page }) => {
  const base = uniqueEmail();
  // 1st: a real contact message → the acknowledgement is sent.
  const tok1 = token();
  await sendContact(page, tagged(base, "one"), `E2E budget first ${tok1}`);
  await expect(page.locator(".contact-sent")).toBeVisible();
  const first = (await messageByToken(tok1))!;
  await expect.poll(async () => (await logByKey(`contact.ack:${first.id}`))?.status).toBe("sent");
  await waitForEmail({ to: tagged(base, "one"), subjectIncludes: ACK });

  // 2nd and 3rd this hour: other acknowledgement kinds to the same person count too (direct EmailLog rows: one sent, one
  // attempted). Password reset links have their own pool and are not counted here (see the next tests).
  await q(`INSERT INTO "EmailLog" (id, kind, "toEmail", subject, status) VALUES ($1, 'signup.welcome', $2, 'E2E budget', 'sent'), ($3, 'join.ack', $4, 'E2E budget', 'failed')`,
    [e2eId(), tagged(base, "two"), e2eId(), base]);
  // A skipped row (e.g. SMTP not configured) does not count.
  await q(`INSERT INTO "EmailLog" (id, kind, "toEmail", subject, status, error) VALUES ($1, 'join.ack', $2, 'E2E budget', 'skipped', 'SMTP not configured')`, [e2eId(), base]);

  // 4th: same answer for the visitor, the message is saved, the acknowledgement is skipped with "budget" and never arrives.
  const tok2 = token();
  const fourth = tagged(base, "four");
  await sendContact(page, fourth, `E2E budget fourth ${tok2}`);
  await expect(page.locator(".contact-sent")).toContainText(t("contact.sentTitle").trim());
  const saved = (await messageByToken(tok2))!;
  expect(saved.email, "the stored address keeps its +tag").toBe(fourth);
  await expect.poll(async () => (await logByKey(`contact.ack:${saved.id}`))?.status).toBe("skipped");
  const row = (await logByKey(`contact.ack:${saved.id}`))!;
  expect(row).toMatchObject({ kind: "contact.ack", toEmail: fourth, error: "budget", messageId: null });
  // Staff notifications are not limited.
  await expect.poll(async () => (await logByKey(`contact.notify:${saved.id}`))?.status).toBe("sent");
  expect(await expectNoEmail({ to: fourth, ms: 3_000 }), "no acknowledgement over budget").toBe(true);
});

test("send budget: a flood of acknowledgements to other addresses never blocks a real password reset (separate pool)", async ({ page }) => {
  const n = Number(process.env.E2E_EMAIL_UNVERIFIED_HOURLY_CAP || 1000);
  test.skip(!(n > 0 && n <= 20_000), "E2E_EMAIL_UNVERIFIED_HOURLY_CAP must be 1–20000");
  const u = await createUser();
  const prefix = `e2e-ackflood-${RUN}-${crypto.randomBytes(3).toString("hex")}-`;
  try {
    // The acknowledgement pool is full (n contact.ack sent in the last hour) …
    await q(`INSERT INTO "EmailLog" (id, kind, "toEmail", subject, status)
             SELECT $1 || g, 'contact.ack', 'e2e-' || $2 || '-ackflood' || g || '@example.test', 'E2E flood', 'sent' FROM generate_series(1, $3::int) g`, [prefix, RUN, n]);
    // … yet the reset link is still emailed.
    await requestReset(page, u.email);
    await expectSentState(page);
    await waitForEmail({ to: u.email, subjectIncludes: RESET_LINK });
  } finally {
    await q(`DELETE FROM "EmailLog" WHERE id LIKE $1`, [`${prefix}%`]);
  }
});

test("send budget: over the hourly total of reset links, a password reset link is skipped (skipped/budget) but the token is issued; sending resumes below it", async ({ page }) => {
  const n = Number(process.env.E2E_EMAIL_UNVERIFIED_HOURLY_CAP || 1000);
  test.skip(!(n > 0 && n <= 20_000), "E2E_EMAIL_UNVERIFIED_HOURLY_CAP must be 1–20000");
  const u = await createUser();
  const prefix = `e2e-flood-${RUN}-${crypto.randomBytes(3).toString("hex")}-`;
  const resetLogs = () => q<LogRow>(`SELECT * FROM "EmailLog" WHERE "userId" = $1 AND kind = 'password.reset_link' ORDER BY "createdAt"`, [u.id]);
  try {
    // n other password reset links sent in the last hour (synthetic rows, deleted below).
    await q(`INSERT INTO "EmailLog" (id, kind, "toEmail", subject, status)
             SELECT $1 || g, 'password.reset_link', 'e2e-' || $2 || '-flood' || g || '@example.test', 'E2E flood', 'sent' FROM generate_series(1, $3::int) g`, [prefix, RUN, n]);
    await requestReset(page, u.email);
    await expectSentState(page);
    await expect.poll(async () => (await resetLogs()).map((r) => r.status)).toEqual(["skipped"]);
    expect((await resetLogs())[0]).toMatchObject({ error: "budget", messageId: null, toEmail: u.email });
    expect(await count(`SELECT count(*) AS n FROM "PasswordResetToken" WHERE "userId" = $1`, [u.id]), "the token is still issued").toBe(1);
    expect(await expectNoEmail({ to: u.email, ms: 3_000 })).toBe(true);
  } finally {
    await q(`DELETE FROM "EmailLog" WHERE id LIKE $1`, [`${prefix}%`]);
  }
  // Below the total again (and the skipped row does not count for this person): the next request is emailed.
  await requestReset(page, u.email);
  await expectSentState(page);
  await waitForEmail({ to: u.email, subjectIncludes: RESET_LINK });
  await expect.poll(async () => (await resetLogs()).map((r) => r.status)).toEqual(["skipped", "sent"]);
});

/* ── M2: build check of the email link origin ──────────────────────────────────── */

test.describe("check-env: NEXT_PUBLIC_SITE_URL must be https and on APP_URL's host", () => {
  /** Runs scripts/check-env.mjs with a minimal, made-up environment (never the real one). */
  const checkEnv = (vars: Record<string, string>) => {
    const db = "postgresql://user:pass@127.0.0.1:5432/check_env_test";
    const r = spawnSync(process.execPath, [path.join(APP_DIR, "scripts/check-env.mjs")], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", AUTH_SECRET: crypto.randomBytes(32).toString("hex"), DATABASE_URL: db, DIRECT_URL: db, ...vars },
      encoding: "utf8", timeout: 20_000,
    });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  test("accepts https on the same host (APP_URL may be http), or no NEXT_PUBLIC_SITE_URL", () => {
    for (const vars of <Record<string, string>[]>[
      { NEXT_PUBLIC_SITE_URL: "https://portal.example.org", APP_URL: "http://portal.example.org" },
      { NEXT_PUBLIC_SITE_URL: "https://Portal.Example.org/", APP_URL: "https://portal.example.org:443" },
      { NEXT_PUBLIC_SITE_URL: "https://portal.example.org" },
      { APP_URL: "http://portal.example.org" },
    ]) {
      const r = checkEnv(vars);
      expect(r.status, `${JSON.stringify(vars)}\n${r.out}`).toBe(0);
      expect(r.out).toContain("[check-env] OK");
    }
  });

  test("fails for a host that differs from APP_URL's (a misspelt domain) with a clear message", () => {
    const r = checkEnv({ NEXT_PUBLIC_SITE_URL: "https://portal.exmaple.org", APP_URL: "https://portal.example.org" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("Cannot build");
    expect(r.out).toContain(`NEXT_PUBLIC_SITE_URL's host "portal.exmaple.org" differs from APP_URL's host "portal.example.org"`);
  });

  test("fails for an http or invalid NEXT_PUBLIC_SITE_URL", () => {
    for (const site of ["http://portal.example.org", "http://localhost:3000"]) {
      const r = checkEnv({ NEXT_PUBLIC_SITE_URL: site });
      expect(r.status, site).toBe(1);
      expect(r.out).toContain("NEXT_PUBLIC_SITE_URL must start with https://");
    }
    const bad = checkEnv({ NEXT_PUBLIC_SITE_URL: "portal.example.org" });
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("NEXT_PUBLIC_SITE_URL is not a valid URL");
  });
});

test("siteUrl(): in production an http origin is upgraded to https (not for localhost)", () => {
  const keys = ["NODE_ENV", "NEXT_PUBLIC_SITE_URL", "APP_URL"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const env = process.env as Record<string, string | undefined>;
  const set = (vars: Partial<Record<(typeof keys)[number], string>>) => { for (const k of keys) { if (vars[k] === undefined) delete env[k]; else env[k] = vars[k]; } };
  try {
    set({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://portal.example.org/" });
    expect(siteUrl("/en/reset-password?token=x")).toBe("https://portal.example.org/en/reset-password?token=x");
    set({ NODE_ENV: "production", APP_URL: "http://portal.example.org" }); // the fallback is upgraded too
    expect(siteUrl()).toBe("https://portal.example.org");
    set({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3200" });
    expect(siteUrl("/en")).toBe("http://localhost:3200/en");
    set({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://portal.example.org" });
    expect(siteUrl()).toBe("http://portal.example.org");
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; }
  }
});

/* ── L4: no addresses in SMTP error text ───────────────────────────────────────── */

test("SMTP error text keeps no address (describeError), and account deletion scrubs addresses from EmailLog.error", async ({ adminPage }) => {
  // The text that goes to EmailLog.error and the server log.
  const err = describeError({ code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 <Some.One+x@Example.test>: Recipient address rejected; cc other@example.org" });
  expect(err).not.toContain("@");
  expect(err).toContain("550 5.1.1 <[address]>: Recipient address rejected; cc [address]");
  expect(redactAddresses("to a@b.test, (c.d@e.test) and \"f@g\"")).toBe("to [address], ([address]) and \"[address]\"");

  // Rows written before the fix (or by any other path): scrubbed when the person's account is deleted.
  const m = await createMember();
  const mine = e2eId(), other = e2eId();
  await q(`INSERT INTO "EmailLog" (id, kind, "toEmail", subject, status, error, "userId") VALUES
           ($1, 'test', $2, 'E2E', 'failed', $3, $4), ($5, 'test', $6, 'E2E', 'failed', $7, NULL)`,
    [mine, m.email, `EENVELOPE 550 <${m.email}>: Recipient address rejected`, m.id, other, uniqueEmail(), `550 mailbox ${m.email} unavailable`]);
  await adminPage.goto(`/en/admin/members/${m.id}`);
  await adminPage.locator("#delete input[name=confirm]").check();
  await adminPage.getByRole("button", { name: t("adminMembers.deleteButton") }).click();
  await expect(adminPage).toHaveURL(/\/en\/admin\/members\?msg=accountDeleted/);
  const rows = await q<LogRow>(`SELECT * FROM "EmailLog" WHERE id = ANY($1) ORDER BY id`, [[mine, other]]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  expect(byId[mine].error).toBe("EENVELOPE 550 <[address]>: Recipient address rejected");
  expect(byId[mine].toEmail).not.toBe(m.email);
  expect(byId[other].error).toBe("550 mailbox [address] unavailable");
  expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE strpos(lower(coalesce(error, '')), $1) > 0`, [m.email])).toBe(0);
});
