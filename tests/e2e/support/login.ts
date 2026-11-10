import type { Page } from "@playwright/test";
import { msg } from "./i18n";

export type Credentials = { email: string; password: string };

/** Sign in through the login form; resolves when the dashboard (or `expectUrl`) is reached. */
export async function uiLogin(page: Page, c: Credentials, opts: { locale?: "en" | "fr"; expectUrl?: RegExp } = {}) {
  const locale = opts.locale ?? "en";
  await page.goto(`/${locale}/login`);
  await page.locator("#le").fill(c.email);
  await page.locator("#lp").fill(c.password);
  await page.locator("main form").getByRole("button", { name: msg("auth.signIn", {}, locale) }).click();
  await page.waitForURL(opts.expectUrl ?? new RegExp(`/${locale}/my/dashboard`));
}
