/**
 * Settings and page content are cached by the running app (Next data cache, tags "settings" / "content-pages") and the
 * cache is only expired by the admin actions. Deleting override rows straight from the database would leave the server
 * showing stale values, so leftover overrides (from a test that failed before its own cleanup) are reset through the
 * admin UI first; restore() then puts the database back exactly.
 */
import { chromium } from "@playwright/test";
import { authFile, BASE_URL, browserOptions } from "./env";
import { q } from "./db";
import { msg } from "./i18n";

export async function resetOverridesViaUi(added: { settings: string[]; contentPages: string[] }): Promise<string[]> {
  const done: string[] = [];
  if (!added.settings.length && !added.contentPages.length) return done;
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
    if (added.contentPages.length) {
      const rows = await q<{ slug: string; locale: string }>(`SELECT slug, locale FROM "ContentPage" WHERE id = ANY($1)`, [added.contentPages]);
      for (const r of rows) {
        await page.goto(`/en/admin/content/${r.slug}/${r.locale}`);
        await page.locator(".cm-reset summary").click();
        await page.getByRole("button", { name: msg("adminContent.resetYes") }).click();
        await page.waitForURL(/msg=/); done.push(`content:${r.locale}/${r.slug}`);
      }
    }
  } finally { await browser.close(); }
  return done;
}
