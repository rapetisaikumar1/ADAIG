/**
 * Shared test fixtures.
 *  - page                      anonymous visitor (the default Playwright page)
 *  - adminPage / memberPage / guestPage   signed in as the seed accounts (storageState saved by the global setup)
 *  - newPage({ role })         another, independent browser session (anonymous or a seed role)
 *  - loginAs(user)             a fresh session signed in through the real login form (throwaway users)
 *  - watchConsole(page)        collects console errors and uncaught page errors
 * All extra contexts use the project's device settings (desktop or mobile) and are closed after the test.
 * Automatic: after each test the rows it wrote without an e2e marker are added to the run ledger (cleanup).
 */
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { authFile, type Role } from "./support/env";
import { uiLogin, expectLoginRefused, type Credentials } from "./support/login";
import { closeDb } from "./support/db";
import { appendLedger, collectSince, dbNow } from "./support/ledger";

export { expect };
export { uiLogin, expectLoginRefused, type Credentials };

export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** The page is no wider than the viewport (no horizontal scrolling). */
export async function expectNoHorizontalOverflow(page: Page, label = "") {
  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(o.doc, `${label} is ${o.doc}px wide in a ${o.view}px viewport`).toBeLessThanOrEqual(o.view + 1);
}

type WorkerFixtures = { _closeDb: void };
type Fixtures = {
  _ledger: void;
  newPage: (opts?: { role?: Role }) => Promise<Page>;
  loginAs: (c: Credentials, opts?: { locale?: "en" | "fr" }) => Promise<Page>;
  adminPage: Page;
  memberPage: Page;
  guestPage: Page;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  // Close the worker's DB pool when the worker ends.
  _closeDb: [async ({}, provide) => { await provide(); await closeDb(); }, { scope: "worker", auto: true }],
  // After every test, record the unmarked rows it made the seed admin write (see support/ledger.ts) for the teardown.
  _ledger: [async ({}, provide) => { const since = await dbNow(); await provide(); appendLedger(await collectSince(since)); }, { auto: true }],
  newPage: async ({ browser, baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (opts = {}) => {
      const ctx = await browser.newContext({
        baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor,
        ...(opts.role ? { storageState: authFile(opts.role) } : {}),
      });
      contexts.push(ctx);
      return ctx.newPage();
    });
    for (const c of contexts) await c.close().catch(() => {});
  },
  loginAs: async ({ newPage }, provide) => {
    await provide(async (c, opts) => { const p = await newPage(); await uiLogin(p, c, opts); return p; });
  },
  adminPage: async ({ newPage }, provide) => { await provide(await newPage({ role: "admin" })); },
  memberPage: async ({ newPage }, provide) => { await provide(await newPage({ role: "member" })); },
  guestPage: async ({ newPage }, provide) => { await provide(await newPage({ role: "guest" })); },
});
