/**
 * Settings are cached by the running app (Next data cache, tag "settings") and the cache is only expired by the admin
 * actions. Deleting override rows straight from the database would leave the server showing stale values, so leftover
 * setting overrides (from a test that failed before its own cleanup) are reset through Admin → Settings first; restore()
 * then puts the database back exactly.
 * Page content overrides (ContentPage) are no longer editable in the admin portal (round 7), so cleanup deletes test rows
 * directly in the database (support/snapshot.ts markerCleanup); the public pages pick that up within the 5-minute revalidate.
 */
import { chromium } from "@playwright/test";
import { authFile, BASE_URL, browserOptions } from "./env";
import { msg } from "./i18n";

export async function resetOverridesViaUi(added: { settings: string[] }): Promise<string[]> {
  const done: string[] = [];
  if (!added.settings.length) return done;
  const { channel, launchOptions } = browserOptions();
  const browser = await chromium.launch({ ...(launchOptions ?? {}), ...(channel ? { channel } : {}) });
  try {
    const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: authFile("admin") });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {}));
    for (const key of added.settings) {
      await page.goto("/en/admin/settings");
      if (key.startsWith("tier.")) await page.locator(`#tier-${key.slice(5)}`).getByRole("button", { name: msg("adminSettings.resetTier") }).click();
      else if (key === "site.contact") await page.locator("#site").getByRole("button", { name: msg("adminSettings.resetSite") }).click();
      else if (key === "ops") await page.locator("#ops").getByRole("button", { name: msg("adminSettings.resetOps") }).click();
      else continue;
      await page.waitForURL(/msg=/); done.push(`setting:${key}`);
    }
  } finally { await browser.close(); }
  return done;
}
