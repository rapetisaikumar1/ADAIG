import { expect, type Page } from "@playwright/test";
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

/**
 * A refused sign-in: the error comes back as form state (no redirect, no ?error= in the URL), shown as a focused role=alert in
 * <main> with `message`, and the typed email is kept. Pass `email` to check it is kept.
 */
export async function expectLoginRefused(page: Page, message: string, opts: { locale?: "en" | "fr"; email?: string } = {}) {
  const locale = opts.locale ?? "en";
  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toHaveText(message);
  await expect(alert).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/${locale}/login$`));
  if (opts.email !== undefined) await expect(page.locator("#le")).toHaveValue(opts.email);
  await expect(page.locator("#lp")).toHaveValue(""); // the rejected password is never kept
}
