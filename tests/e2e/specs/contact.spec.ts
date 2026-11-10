/** Contact form → Admin → Messages → mark handled → reopen; honeypot, rate limit, signed-in defaults. */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, createMember, one, q, e2eId, uniqueEmail, uniqueName, RUN } from "../support/db";
import { t } from "../support/i18n";

type Msg = { id: string; status: string; topic: string; locale: string; userId: string | null; handledBy: string | null; handledAt: Date | null; name: string; organization: string | null };
const byText = (text: string) => one<Msg>(`SELECT * FROM "ContactMessage" WHERE message = $1`, [text]);

async function fillContact(page: Page, v: { name?: string; email?: string; org?: string; topic?: string; message: string }) {
  if (v.name !== undefined) await page.locator("#cf-name").fill(v.name);
  if (v.email !== undefined) await page.locator("#cf-email").fill(v.email);
  if (v.org !== undefined) await page.locator("#cf-org").fill(v.org);
  if (v.topic) await page.locator("#cf-topic").selectOption(v.topic);
  await page.locator("#cf-msg").fill(v.message);
  await page.locator(".contact-form input[name=consent]").check();
}

test("a visitor's message reaches Admin → Messages, is marked handled and reopened", async ({ page, adminPage }) => {
  const text = `E2E message ${RUN} ${Math.random().toString(36).slice(2)} — please call me back.`;
  const name = uniqueName("Visitor"); const email = uniqueEmail();
  await page.goto("/en/contact?topic=events");
  await expect(page.locator("#cf-topic")).toHaveValue("events");
  await fillContact(page, { name, email, org: "E2E Org", message: text });
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator(".contact-sent")).toContainText(t("contact.sentTitle").trim());

  const m = await byText(text);
  expect(m).toMatchObject({ status: "new", topic: "events", locale: "en", userId: null, name, organization: "E2E Org" });
  expect(await auditRows({ action: "contact.message_received", target: m!.id })).toHaveLength(1);

  await adminPage.goto("/en/admin/messages");
  const item = adminPage.locator("li.inbox-item", { hasText: text });
  await expect(item).toHaveClass(/is-new/);
  await expect(item).toContainText(email);
  await expect(item.getByRole("link", { name: email })).toHaveAttribute("href", /^mailto:/);
  await item.getByRole("button", { name: t("inbox.markHandled") }).click();
  await expect(adminPage).toHaveURL(/msg=handled/);
  await expect(adminPage.locator("main").getByRole("status")).toContainText(t("inbox.msgHandled"));
  await expect(adminPage.locator("li.inbox-item", { hasText: text })).toHaveCount(0); // gone from "New"
  const handled = await byText(text);
  expect(handled!.status).toBe("handled");
  expect(handled!.handledBy).toBeTruthy();

  await adminPage.goto("/en/admin/messages?f=handled");
  const h = adminPage.locator("li.inbox-item", { hasText: text });
  await h.getByRole("button", { name: t("inbox.reopen") }).click();
  await expect(adminPage).toHaveURL(/msg=reopened/);
  expect(await byText(text)).toMatchObject({ status: "new", handledBy: null, handledAt: null });

  // The messages CSV export contains it.
  const csv = await adminPage.request.get("/api/admin/messages.csv?f=new");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(text);
});

test("the honeypot field silently drops bot submissions", async ({ page }) => {
  const text = `E2E bot ${RUN} ${Math.random().toString(36).slice(2)} buy now`;
  await page.goto("/en/contact");
  await fillContact(page, { name: "Bot", email: uniqueEmail(), topic: "other", message: text });
  await page.locator("#cf-web").evaluate((el: HTMLInputElement) => { el.value = "https://spam.example"; });
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator(".contact-sent")).toBeVisible();
  expect(await byText(text)).toBeUndefined();
});

test("more than 5 messages per email per hour are refused", async ({ page }) => {
  const email = uniqueEmail();
  for (let i = 0; i < 5; i++)
    await q(`INSERT INTO "ContactMessage" (id, name, email, topic, message, locale) VALUES ($1, 'E2E', $2, 'other', 'E2E earlier message', 'en')`, [e2eId(), email]);
  const text = `E2E sixth ${RUN} ${Math.random().toString(36).slice(2)}`;
  await page.goto("/en/contact");
  await fillContact(page, { name: "E2E Sender", email, topic: "other", message: text });
  await page.getByRole("button", { name: t("contact.send") }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("contact.errRate"));
  await expect(page.locator("#cf-msg")).toHaveValue(text); // what was typed is kept
  expect(await byText(text)).toBeUndefined();
});

test("a signed-in member's details are prefilled and the message is linked to the account", async ({ loginAs }) => {
  const m = await createMember({ organisation: "E2E Member Org" });
  const p = await loginAs(m);
  await p.goto("/fr/contact");
  await expect(p.locator("#cf-name")).toHaveValue(m.name);
  await expect(p.locator("#cf-email")).toHaveValue(m.email);
  await expect(p.locator("#cf-org")).toHaveValue("E2E Member Org");
  const text = `E2E membre ${RUN} ${Math.random().toString(36).slice(2)}`;
  await fillContact(p, { topic: "membership", message: text });
  await p.locator(".contact-form button[type=submit], .contact-form button").last().click();
  await expect(p.locator(".contact-sent")).toBeVisible();
  expect(await byText(text)).toMatchObject({ userId: m.id, locale: "fr", topic: "membership" });
});
