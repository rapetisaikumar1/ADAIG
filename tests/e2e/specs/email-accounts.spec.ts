/**
 * Round 8 emails, accounts (EMAIL_SPEC §2.7–2.12, §3): signup.welcome; the self-service forgot-password flow end to end
 * (link email → reset → sign in with the new password, old one refused, link single-use, expired link refused, only the
 * newest link works, unknown / deactivated addresses get the same page and no email, rate limit); password.changed (profile
 * and reset link), password.reset_by_staff (Members and Users), email.changed (to the OLD address, new one masked),
 * account.deleted (self and staff, address anonymized in EmailLog); no password in any email; a failing send never breaks the
 * staff flow. Verified in Mailpit (actual delivery) and EmailLog; unique recipients, the mailbox is never cleared.
 */
import crypto from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, uiLogin, expectLoginRefused } from "../fixtures";
import { ROLE_PRESETS, auditRows, count, createAdmin, createMember, createUser, one, q, userByEmail, userById, uniqueEmail, uniqueName, uniquePassword, RUN } from "../support/db";
import { BASE_URL } from "../support/env";
import { t } from "../support/i18n";
import { expectNoEmail, listEmails, waitForEmail, type Mail } from "../support/mail";

/* ── email helpers (same block in every email-*.spec.ts) ──────────────────────────── */
const INBOX = (process.env.E2E_CONTACT_TO_EMAIL || "info@adaig.test").toLowerCase();
const FROM = process.env.E2E_CONTACT_FROM_EMAIL || "ADAIG Website <info@adaig.test>";
const SITE = (process.env.E2E_SITE_URL || BASE_URL).replace(/\/$/, "");
const ET = "America/New_York";
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: ET });
const txt = (m: Mail) => m.text.replace(/\r\n/g, "\n");

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
const mailCount = async (to: string, subject: string) => (await listEmails(`to:"${to}"`)).filter((m) => m.to.includes(to.toLowerCase()) && m.subject === subject).length;
/* ───────────────────────────────────────────────────────────────────────────────── */

const WELCOME = "Welcome to ADAIG: your account is ready";
const RESET_LINK = "Reset your ADAIG password";
const CHANGED = "Your ADAIG password was changed";
const RESET_BY_STAFF = "Your ADAIG password was reset";
const EMAIL_CHANGED = "Your ADAIG sign-in email was changed";
const DELETED = "Your ADAIG account has been deleted";
const SECURITY_FOOTER = "This is a security notice about your ADAIG account.";

const tm = (k: string, v?: Record<string, string | number>) => t(`adminMembers.${k}`, v);
const tu = (k: string, v?: Record<string, string | number>) => t(`adminUsers.${k}`, v);
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/* ── forgot-password helpers (EMAIL_SPEC §3) ── */
type Token = { id: string; tokenHash: string; expiresAt: Date; usedAt: Date | null; createdAt: Date };
const tokensOf = (userId: string) => q<Token>(`SELECT id, "tokenHash", "expiresAt", "usedAt", "createdAt" FROM "PasswordResetToken" WHERE "userId" = $1 ORDER BY "createdAt" DESC`, [userId]);

async function requestReset(p: Page, email: string) {
  await p.goto("/en/forgot-password");
  await expect(p.locator("main h1")).toHaveText(t("auth.forgotTitle"));
  await p.locator("main form input[name=email]").fill(email);
  await p.locator("main form").getByRole("button", { name: t("auth.forgotSubmit") }).click();
}
/** The "check your email" state: identical whatever the address (no account enumeration). */
async function expectSentState(p: Page, email: string) {
  const ok = p.locator("main").getByRole("status");
  await expect(ok).toContainText(t("auth.forgotSentTitle"));
  await expect(ok).toContainText(t("auth.forgotSentBody", { email }));
  return (await ok.innerText()).replace(email, "<email>");
}
/** The reset link from the email (absolute, /en, 43-char base64url token) and its path for this test's base URL. */
function resetLinkOf(m: Mail) {
  const link = new RegExp(`${SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/en/reset-password\\?token=([A-Za-z0-9_-]{43})`).exec(txt(m));
  expect(link, "reset link in the text part").toBeTruthy();
  expect(m.html).toContain(`href="${link![0]}"`);
  return { url: link![0], token: link![1], path: `/en/reset-password?token=${link![1]}` };
}
async function fillReset(p: Page, password: string, confirm = password) {
  await p.locator("main form input[name=password]").fill(password);
  await p.locator("main form input[name=confirm]").fill(confirm);
  await p.locator("main form").getByRole("button", { name: t("auth.resetSubmit") }).click();
}
async function expectInvalidLink(p: Page) {
  const alert = p.locator("main").getByRole("alert");
  await expect(alert).toContainText(t("auth.resetInvalidTitle"));
  await expect(alert).toContainText(t("auth.resetInvalidBody"));
  await expect(p.locator("main input[name=password]")).toHaveCount(0);
  await expect(p.locator("main").getByRole("link", { name: t("auth.resetRequestNew") })).toHaveAttribute("href", "/en/forgot-password");
}

/* ── sign-up ───────────────────────────────────────────────────────────────────── */

test("sign-up: the new guest gets one welcome email (no name echo, no password); a repeat sign-up with that email sends nothing", async ({ page, newPage }) => {
  const email = uniqueEmail(); const password = uniquePassword(); const name = uniqueName("<b>Guest</b>");
  await page.goto("/en/signup");
  await page.locator("#sn").fill(name);
  await page.locator("#se").fill(email);
  await page.locator("#sp").fill(password);
  await page.getByRole("button", { name: t("auth.createBtn") }).click();
  await expect(page).toHaveURL(/\/en\/my\/billing(\?|$)/);
  const u = (await userByEmail(email))!;

  const m = await waitForEmail({ to: email, subjectIncludes: WELCOME });
  expectMail(m, {
    to: email, replyTo: INBOX, subject: WELCOME,
    text: [
      "Your account is ready", "Hello,",
      "Thank you for creating a free guest account with the Association for Data and AI Governance (ADAIG).",
      "A guest account is free but isn’t a membership.",
      `Account email: ${email}`, "Account type: Free guest account", `Created: ${day(new Date())}`,
      `Go to your account: ${SITE}/en/my/billing`,
    ],
    never: [password, "Guest</b>", "&lt;b&gt;Guest", name],
  });
  await expectLogSent(`signup.welcome:${u.id}`, { kind: "signup.welcome", to: email, subject: WELCOME, userId: u.id });

  // Same email again → generic error, no second welcome.
  const other = await newPage();
  await other.goto("/en/signup");
  await other.locator("#sn").fill(uniqueName("Again")); await other.locator("#se").fill(email); await other.locator("#sp").fill(uniquePassword());
  await other.getByRole("button", { name: t("auth.createBtn") }).click();
  await expect(other.locator("main").getByRole("alert")).toHaveText(t("join.err_generic_account"));
  await new Promise((r) => setTimeout(r, 2_000));
  expect(await mailCount(email, WELCOME)).toBe(1);
});

/* ── forgot password ───────────────────────────────────────────────────────────── */

test("forgot password: link email → new password → sign in; old password and reused link refused; password.changed sent @smoke", async ({ page, newPage }) => {
  const u = await createUser({ role: "member" });
  const newPw = uniquePassword();
  const before = (await userById(u.id))!;

  // The sign-in page links to the self-service flow.
  await page.goto("/en/login");
  await page.locator("main").getByRole("link", { name: t("auth.forgot") }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password$/);
  await requestReset(page, u.email.toUpperCase()); // normalized
  await expectSentState(page, u.email);

  const m = await waitForEmail({ to: u.email, subjectIncludes: RESET_LINK });
  const [tok] = await tokensOf(u.id);
  expectMail(m, {
    to: u.email, replyTo: INBOX, subject: RESET_LINK,
    text: [
      "Reset your password", "Hello,",
      "We received a request to reset the password for the ADAIG account that uses this email address.",
      `The link works once and expires in 60 minutes, at ${day(tok.expiresAt)} at `,
      "If you didn’t ask to reset your password, you can ignore this email: your password won’t change.",
      `Account: ${u.email}`, `Requested: ${day(tok.createdAt)} at `, `Link expires: ${day(tok.expiresAt)} at `,
    ],
    never: [u.password],
  });
  const link = resetLinkOf(m);
  // Stored hashed (sha256 hex), 60 minutes, unused; the raw token is stored nowhere.
  expect(tok.tokenHash).toBe(sha256(link.token));
  expect(+tok.expiresAt - +tok.createdAt).toBeGreaterThan(59 * 60_000);
  expect(+tok.expiresAt - +tok.createdAt).toBeLessThanOrEqual(61 * 60_000);
  expect(tok.usedAt).toBeNull();
  expect(await count(`SELECT count(*) AS n FROM "PasswordResetToken" WHERE "tokenHash" = $1`, [link.token])).toBe(0);
  expect(await count(`SELECT count(*) AS n FROM "AuditLog" WHERE target LIKE $1 OR actor LIKE $1`, [`%${link.token}%`])).toBe(0);
  expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE subject LIKE $1 OR "dedupeKey" LIKE $1 OR coalesce(error, '') LIKE $1`, [`%${link.token}%`])).toBe(0);
  await expectLogSent(`password.reset_link:${tok.id}`, { kind: "password.reset_link", to: u.email, subject: RESET_LINK, userId: u.id });
  expect(await auditRows({ action: "auth.password_reset_requested", target: u.id })).toHaveLength(1);

  // Opening the link (GET) shows the form and consumes nothing (mail scanners prefetch links).
  await page.goto(link.path);
  await expect(page.locator("main h1")).toHaveText(t("auth.resetTitle"));
  expect((await tokensOf(u.id))[0].usedAt).toBeNull();
  // Mismatch → error, token still valid.
  await fillReset(page, newPw, `${newPw}x`);
  await expect(page.locator("main").getByRole("alert")).toContainText(t("auth.resetErr_mismatch"));
  expect((await tokensOf(u.id))[0].usedAt).toBeNull();
  // Real reset.
  await fillReset(page, newPw);
  await expect(page).toHaveURL(/\/en\/login\?reset=done$/);
  await expect(page.locator("main").getByRole("status")).toContainText(t("auth.resetDone"));
  const after = (await userById(u.id))!;
  expect(after.passwordHash).not.toBe(before.passwordHash);
  expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  expect((await tokensOf(u.id))[0].usedAt).toBeTruthy();
  const [audit] = await auditRows({ action: "auth.password_reset_via_email", target: u.id });
  expect(audit).toBeTruthy();

  // password.changed (via the reset link): never the old or the new password.
  const c = await waitForEmail({ to: u.email, subjectIncludes: CHANGED });
  expectMail(c, {
    to: u.email, replyTo: INBOX, subject: CHANGED,
    text: [
      "Your password was changed", "Hello,",
      "The password for your ADAIG account was changed on ", "using a password reset link. You’ve been signed out on every device.",
      `Account: ${u.email}`, `Sign in: ${SITE}/en/login`, SECURITY_FOOTER,
    ],
    never: [newPw, u.password, link.token],
  });
  await expectLogSent(`password.changed:${audit.id}`, { kind: "password.changed", to: u.email, subject: CHANGED, userId: u.id });

  // Old password refused, new password accepted.
  const s = await newPage();
  await s.goto("/en/login");
  await s.locator("#le").fill(u.email); await s.locator("#lp").fill(u.password);
  await s.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(s, t("auth.invalid"), { email: u.email });
  await uiLogin(s, { email: u.email, password: newPw }, { expectUrl: /\/en\/my\/billing$/ });

  // The link can't be used again.
  const again = await newPage();
  await again.goto(link.path);
  await expectInvalidLink(again);
  expect((await userById(u.id))!.passwordHash).toBe(after.passwordHash);
  expect(await mailCount(u.email, RESET_LINK)).toBe(1);
  expect(await mailCount(u.email, CHANGED)).toBe(1);
});

test("forgot password: an expired link and an older link are refused; a garbage token shows the invalid state", async ({ page }) => {
  const u = await createUser();
  const before = (await userById(u.id))!;
  await requestReset(page, u.email);
  await expectSentState(page, u.email);
  const first = resetLinkOf(await waitForEmail({ to: u.email, subjectIncludes: RESET_LINK }));

  // A second request invalidates the first link; only the newest works.
  const t2 = new Date();
  await requestReset(page, u.email);
  await expectSentState(page, u.email);
  const second = resetLinkOf(await waitForEmail({ to: u.email, subjectIncludes: RESET_LINK, after: new Date(+t2 - 1_000) }));
  expect(second.token).not.toBe(first.token);
  await page.goto(first.path);
  await expectInvalidLink(page);
  await page.goto(second.path);
  await expect(page.locator("main input[name=password]")).toBeVisible();

  // Expired (moved past its 60 minutes in the DB) → invalid; the password does not change.
  await q(`UPDATE "PasswordResetToken" SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`, [u.id]);
  await page.goto(second.path);
  await expectInvalidLink(page);
  expect((await userById(u.id))!.passwordHash).toBe(before.passwordHash);

  await page.goto(`/en/reset-password?token=${"A".repeat(43)}`);
  await expectInvalidLink(page);
  await page.goto("/en/reset-password?token=not-a-token");
  await expectInvalidLink(page);
  expect(await mailCount(u.email, CHANGED)).toBe(0);
});

test("forgot password: unknown and deactivated addresses get the same page and no email; invalid format and rate limit", async ({ page }) => {
  const known = await createUser();
  const unknown = uniqueEmail();
  const inactive = await createAdmin(ROLE_PRESETS.viewer, { active: false }); // Admin Portal accounts may use the flow; deactivated ones get nothing

  await requestReset(page, known.email);
  const shape = await expectSentState(page, known.email);
  await waitForEmail({ to: known.email, subjectIncludes: RESET_LINK });

  for (const email of [unknown, inactive.email]) {
    await requestReset(page, email);
    expect(await expectSentState(page, email), `same answer for ${email}`).toBe(shape);
  }
  expect(await expectNoEmail({ to: unknown, ms: 4_000 }), "no email to an unknown address").toBe(true);
  expect(await expectNoEmail({ to: inactive.email, ms: 1_000 }), "no email to a deactivated account").toBe(true);
  expect(await tokensOf(inactive.id)).toHaveLength(0);
  expect(await count(`SELECT count(*) AS n FROM "EmailLog" WHERE "toEmail" = ANY($1)`, [[unknown, inactive.email]])).toBe(0);
  expect(await count(`SELECT count(*) AS n FROM "AuditLog" WHERE target = $1`, [unknown])).toBe(0);

  // Invalid format → field error.
  await page.goto("/en/forgot-password");
  await page.locator("main form").evaluate((f: HTMLFormElement) => { f.noValidate = true; }); // skip the browser's own check so the server answers
  await page.locator("main form input[name=email]").fill("not-an-email");
  await page.locator("main form").getByRole("button", { name: t("auth.forgotSubmit") }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(t("auth.forgotErrEmail"));

  // Rate limit: at most 3 requests per address per hour (counted for unknown addresses too).
  const limited = uniqueEmail();
  for (let i = 0; i < 3; i++) { await requestReset(page, limited); await expectSentState(page, limited); }
  await requestReset(page, limited);
  await expect(page.locator("main").getByRole("alert")).toContainText(t("auth.forgotErrRate"));
  await expect(page.locator("main form input[name=email]")).toHaveValue(limited); // typed input kept
  expect(await expectNoEmail({ to: limited, ms: 1_000 })).toBe(true);
});

test("forgot password: deactivating an Admin Portal account deletes its reset links; after reactivation the old link stays invalid", async ({ page, adminPage: p }) => {
  const u = await createAdmin(ROLE_PRESETS.viewer);
  await requestReset(page, u.email);
  await expectSentState(page, u.email);
  const link = resetLinkOf(await waitForEmail({ to: u.email, subjectIncludes: RESET_LINK }));
  expect(await tokensOf(u.id)).toHaveLength(1);

  // Admin → Users: deactivate (round-8 SEC L3: the token rows go with it).
  await p.goto(`/en/admin/users/${encodeURIComponent(u.id)}`);
  await p.locator("#status summary", { hasText: tu("deactivate") }).click();
  const form = p.locator("form#status, #status form").filter({ has: p.getByRole("button", { name: tu("deactivateYes") }) });
  const box = form.locator("input[type=checkbox][name=confirm]");
  if (await box.count()) await box.check();
  await form.getByRole("button", { name: tu("deactivateYes") }).click();
  await expect(p).toHaveURL(/msg=msg_deactivated/);
  expect(await tokensOf(u.id), "reset tokens deleted on deactivation").toHaveLength(0);

  // Reactivate within the hour: the old link does not come back to life.
  await p.goto(`/en/admin/users/${encodeURIComponent(u.id)}`);
  await p.locator("#status").getByRole("button", { name: tu("activate"), exact: true }).click();
  await expect(p).toHaveURL(/msg=msg_activated/);
  expect((await userById(u.id))!.active).toBe(true);
  await page.goto(link.path);
  await expectInvalidLink(page);
});

/* ── security notices ──────────────────────────────────────────────────────────── */

test("password changed in Profile & privacy: confirmation email without any password", async ({ loginAs }) => {
  const u = await createUser({ role: "member" });
  const p = await loginAs(u);
  const next = uniquePassword();
  await p.goto("/en/my/profile");
  await p.locator("#pc").fill(u.password);
  await p.locator("#pn").fill(next);
  await p.locator("#pr").fill(next);
  await p.getByRole("button", { name: t("profile.pwSave") }).click();
  await expect(p).toHaveURL(/\/en\/login\?pw=changed/);
  const [audit] = await auditRows({ action: "auth.password_changed", target: u.id });

  const m = await waitForEmail({ to: u.email, subjectIncludes: CHANGED });
  expectMail(m, {
    to: u.email, replyTo: INBOX, subject: CHANGED,
    text: ["Hello,", "in Profile & privacy. You’ve been signed out on every device. Sign in again with your new password.", `Account: ${u.email}`, `Changed: ${day(new Date())} at `, `Sign in: ${SITE}/en/login`],
    never: [u.password, next, u.name],
  });
  await expectLogSent(`password.changed:${audit.id}`, { kind: "password.changed", to: u.email, subject: CHANGED, userId: u.id });
});

test("Members: a staff temporary password sends a notice that never contains the password", async ({ adminPage: p }) => {
  const u = await createMember();
  const temp = uniquePassword();
  await p.goto(`/en/admin/members/${u.id}`);
  await p.locator("#pw-new").fill(temp);
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(p.getByRole("form", { name: tm("pwTitle") }).getByRole("status").locator("code")).toHaveText(temp);
  const [audit] = await auditRows({ action: "admin.password_reset", target: u.id });

  const m = await waitForEmail({ to: u.email, subjectIncludes: RESET_BY_STAFF });
  expectMail(m, {
    to: u.email, replyTo: INBOX, subject: RESET_BY_STAFF,
    text: [
      "Your password was reset", `Hello ${u.name},`,
      "A member of the ADAIG team set a temporary password for your ADAIG account on ",
      "For your security, this email doesn’t include the password: the team will give it to you directly.",
      "After you sign in with the temporary password, change it in Profile & privacy.",
      `Account: ${u.email}`, `Sign in: ${SITE}/en/login`,
    ],
    never: [temp, u.password],
  });
  await expectLogSent(`password.reset_by_staff:${audit.id}`, { kind: "password.reset_by_staff", to: u.email, subject: RESET_BY_STAFF, userId: u.id });
});

test("Users: an admin password reset sends the Admin Portal notice without the password", async ({ adminPage: p }) => {
  const u = await createAdmin(ROLE_PRESETS.viewer);
  const pw = uniquePassword();
  await p.goto(`/en/admin/users/${encodeURIComponent(u.id)}`);
  const form = p.locator("form#password, #password form");
  await form.getByLabel(tu("pwNew"), { exact: true }).fill(pw);
  await form.getByLabel(tu("pwConfirm"), { exact: true }).fill(pw);
  await form.getByRole("button", { name: tu("pwButton") }).click();
  await expect(form.getByRole("status")).toContainText(tu("msg_pwReset"));
  const [audit] = await auditRows({ action: "admin_user.password_reset", target: u.id });

  const m = await waitForEmail({ to: u.email, subjectIncludes: RESET_BY_STAFF });
  expectMail(m, {
    to: u.email, replyTo: INBOX, subject: RESET_BY_STAFF,
    text: [`Hello ${u.name},`, "An administrator set a new password for your ADAIG Admin Portal account on ", "ask the administrator who reset it."],
    never: [pw, u.password],
  });
  await expectLogSent(`password.reset_by_staff:${audit.id}`, { kind: "password.reset_by_staff", to: u.email, subject: RESET_BY_STAFF, userId: u.id });
});

test("Members and Users: an email change notifies the OLD address with the new one masked", async ({ adminPage: p }) => {
  // Members (variant member).
  const u = await createUser({ name: uniqueName("Renamed") });
  const next = uniqueEmail();
  await p.goto(`/en/admin/members/${u.id}`);
  await p.locator("#p-email").fill(next);
  await p.getByRole("button", { name: tm("saveProfile") }).click();
  await expect(p).toHaveURL(/msg=msg_profileSaved/);
  const [audit] = await auditRows({ action: "admin.email_changed", target: u.id });
  const masked = `${next.slice(0, 1)}•••@${next.split("@")[1]}`;

  const m = await waitForEmail({ to: u.email, subjectIncludes: EMAIL_CHANGED });
  expectMail(m, {
    to: u.email, replyTo: INBOX, subject: EMAIL_CHANGED,
    text: [
      "Your sign-in email was changed", `Hello ${u.name},`,
      "The ADAIG team changed the email address you use to sign in to ADAIG on ", `From now on, sign in with ${masked}.`,
      `Previous email: ${u.email}`, `New email: ${masked}`, `Contact the ADAIG team: ${SITE}/en/contact?topic=account`,
    ],
    never: [next, u.password],
  });
  await expectLogSent(`email.changed:${audit.id}`, { kind: "email.changed", to: u.email, subject: EMAIL_CHANGED, userId: u.id });
  expect(await expectNoEmail({ to: next, subjectIncludes: EMAIL_CHANGED, ms: 1_500 }), "nothing to the new address").toBe(true);

  // Users (variant admin).
  const a = await createAdmin(ROLE_PRESETS.viewer);
  const nextA = uniqueEmail();
  await p.goto(`/en/admin/users/${encodeURIComponent(a.id)}`);
  await p.locator("#details").getByLabel(tu("f_email"), { exact: true }).fill(nextA);
  await p.locator("#details").getByRole("button", { name: tu("saveDetails") }).click();
  await expect(p).toHaveURL(/msg=msg_saved/);
  const [auditA] = await auditRows({ action: "admin_user.email_changed", target: a.id });
  const ma = await waitForEmail({ to: a.email, subjectIncludes: EMAIL_CHANGED });
  expectMail(ma, {
    to: a.email, replyTo: INBOX, subject: EMAIL_CHANGED,
    text: [`Hello ${a.name},`, "An administrator changed the email address you use to sign in to the ADAIG Admin Portal on ", `Previous email: ${a.email}`],
    never: [nextA, a.password],
  });
  await expectLogSent(`email.changed:${auditA.id}`, { kind: "email.changed", to: a.email, subject: EMAIL_CHANGED, userId: a.id });
});

test("account deleted (self and by staff): last email to the old address; the log keeps no trace of it", async ({ loginAs, adminPage }) => {
  // Self-service.
  const m = await createMember();
  const p = await loginAs(m);
  await p.goto("/en/my/profile");
  await p.locator("form.mbr-danger #dp").fill(m.password);
  await p.locator("form.mbr-danger input[name=confirm]").check();
  await p.locator("form.mbr-danger").getByRole("button", { name: t("profile.deleteBtn") }).click();
  await expect(p).toHaveURL(/\/en\/login\?deleted=1/);

  const e = await waitForEmail({ to: m.email, subjectIncludes: DELETED });
  expectMail(e, {
    to: m.email, replyTo: INBOX, subject: DELETED,
    text: [
      "Your account has been deleted", "Hello,", "As you requested, your ADAIG account was deleted on ",
      "You can no longer sign in with this email address.", `Account: ${m.email}`,
      `Contact the ADAIG team: ${SITE}/en/contact?topic=privacy`,
    ],
    never: [m.password, m.name],
  });
  await expect.poll(async () => (await logByKey(`account.deleted:${m.id}`))?.status).toBe("sent");
  const row = (await logByKey(`account.deleted:${m.id}`))!;
  expect(row.kind).toBe("account.deleted");
  expect(row.toEmail).not.toBe(m.email); // anonymized after sending
  await expect.poll(() => count(`SELECT count(*) AS n FROM "EmailLog" WHERE lower("toEmail") = $1`, [m.email])).toBe(0);

  // By staff (Admin → Members).
  const s = await createMember();
  await adminPage.goto(`/en/admin/members/${s.id}`);
  await adminPage.locator("#delete input[name=confirm]").check();
  await adminPage.getByRole("button", { name: tm("deleteButton") }).click();
  await expect(adminPage).toHaveURL(/\/en\/admin\/members\?msg=accountDeleted/);
  const se = await waitForEmail({ to: s.email, subjectIncludes: DELETED });
  expectMail(se, { to: s.email, replyTo: INBOX, subject: DELETED, text: ["Your ADAIG account was deleted by the ADAIG team on ", `Account: ${s.email}`], never: [s.password] });
  await expect.poll(() => count(`SELECT count(*) AS n FROM "EmailLog" WHERE lower("toEmail") = $1`, [s.email])).toBe(0);
});

/* ── failures never break the flow ─────────────────────────────────────────────── */

test("a failing send never breaks the flow: staff reset for an undeliverable stored address completes, EmailLog says failed", async ({ adminPage: p }) => {
  // An address the app's validator refuses (consecutive dots) stored directly: sendEmail refuses it → status "failed".
  const bad = `e2e-${RUN}-bad..${crypto.randomBytes(3).toString("hex")}@example.test`;
  const u = await createUser({ email: bad });
  const temp = uniquePassword();
  await p.goto(`/en/admin/members/${u.id}`);
  await p.locator("#pw-new").fill(temp);
  await p.getByRole("button", { name: tm("pwButton") }).click();
  // The staff action completed normally (the password is set and shown once).
  await expect(p.getByRole("form", { name: tm("pwTitle") }).getByRole("status").locator("code")).toHaveText(temp);
  expect((await userById(u.id))!.sessionVersion).toBe(1);
  const [audit] = await auditRows({ action: "admin.password_reset", target: u.id });
  await expect.poll(async () => (await logByKey(`password.reset_by_staff:${audit.id}`))?.status).toBe("failed");
  const row = (await logByKey(`password.reset_by_staff:${audit.id}`))!;
  expect(row.error).toBeTruthy();
  expect(row.error).not.toContain(temp);
  expect(row.messageId).toBeNull();
});
