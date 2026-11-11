/**
 * Admin → Settings: tier rename (visible on /membership and /join; stored French texts kept), add a benefit (French lines stay
 * paired), hide a tier, reset; public contact details
 * card; operational policies. Each test restores the defaults through the UI in `finally` (expires the settings cache).
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, one, RUN } from "../support/db";
import { t, tFr } from "../support/i18n";
import { tiers as defaultTiers } from "../../../src/config/site";

const ts = (k: string) => t(`adminSettings.${k}`);
const settings = (p: Page) => p.goto("/en/admin/settings");
const row = (key: string) => one<{ key: string; value: unknown }>(`SELECT key, value FROM "Setting" WHERE key = $1`, [key]);

/** Reset a settings block through the UI if it is customized (no-op otherwise). */
async function resetBlock(p: Page, key: string) {
  if (!(await row(key))) return;
  await settings(p);
  // Each reset has a confirm step: open it, then "Yes, reset".
  const [scope, label] = key.startsWith("tier.") ? [`#tier-${key.slice(5)}`, ts("resetTier")] : key === "site.contact" ? ["#site", ts("resetSite")] : ["#ops", ts("resetOps")];
  await p.locator(`${scope} summary`, { hasText: label }).click();
  await p.locator(`${scope} details[open]`).getByRole("button", { name: ts("resetYes") }).click();
  await expect(p).toHaveURL(/msg=reset/);
}

test("rename a tier: shown on /membership and /join; the French name is kept; then reset", async ({ adminPage: p, page }) => {
  // French is not offered in the admin since round 6b: no French inputs, the stored French texts are re-submitted unchanged.
  const en = `Professional E2E ${RUN}`, fr = defaultTiers.find((x) => x.id === "professional")!.name.fr; // stored French name (default), unchanged
  try {
    await settings(p);
    const form = p.locator("#tier-professional");
    await expect(form.locator("#t-professional-nf, #t-professional-df, #t-professional-bf")).toHaveCount(0);
    await form.locator("#t-professional-ne").fill(en);
    await form.getByRole("button", { name: ts("saveTier") }).click();
    await expect(p).toHaveURL(/msg=saved&s=tier-professional/);
    await expect(p.locator("#tier-professional .alert-success")).toHaveText(ts("msg_saved"));
    await expect(p.locator("#tier-professional").getByText(ts("customized"), { exact: true })).toBeVisible();
    expect(await row("tier.professional")).toMatchObject({ value: expect.objectContaining({ name: { en, fr } }) });
    expect(await auditRows({ action: "settings.tier_updated", target: "tier.professional" })).not.toHaveLength(0);

    await page.goto("/en/membership");
    await expect(page.locator(".tier h3", { hasText: en })).toBeVisible();
    await page.goto("/en/join");
    await expect(page.locator("#tier option[value=professional]")).toHaveText(en);
    await page.goto("/fr/membership");
    await expect(page.locator(".tier h3", { hasText: fr })).toBeVisible();

    await resetBlock(p, "tier.professional");
    await expect(p.locator("#tier-professional .alert-success")).toHaveText(ts("msg_reset"));
    expect(await row("tier.professional")).toBeUndefined();
    await page.goto("/en/membership");
    await expect(page.locator(".tier h3", { hasText: "Professional" })).toBeVisible();
    await expect(page.locator(".tier h3", { hasText: en })).toHaveCount(0);
  } finally { await resetBlock(p, "tier.professional"); }
});

test("add and remove a benefit line: saves without a French field, the stored French lines stay paired", async ({ adminPage: p }) => {
  type Tier = { benefits: { en: string; fr: string }[] };
  const extra = `E2E benefit ${RUN}`;
  try {
    await settings(p);
    const form = p.locator("#tier-retired"); const ta = form.locator("textarea[name=benefitsEn]");
    const before = (await ta.inputValue()).split("\n");
    // Add a line at the end and drop the first one: the count changes, the kept lines keep their French text.
    await ta.fill([...before.slice(1), extra].join("\n"));
    await form.getByRole("button", { name: ts("saveTier") }).click();
    await expect(p).toHaveURL(/msg=saved&s=tier-retired/);
    const saved = (await row("tier.retired"))!.value as Tier;
    expect(saved.benefits.map((b) => b.en)).toEqual([...before.slice(1), extra]);
    // Kept lines keep their own French line (default pairs); the new line has no translation yet, so its English is stored.
    const pairs = defaultTiers.find((x) => x.id === "retired")!.benefits;
    expect(saved.benefits).toEqual([...pairs.slice(1), { en: extra, fr: extra }]);
  } finally { await resetBlock(p, "tier.retired"); }
});

test("hide a tier: it disappears from /membership and /join, then reset", async ({ adminPage: p, page }) => {
  try {
    await settings(p);
    const form = p.locator("#tier-retired");
    await form.locator("input[name=visible]").uncheck();
    await form.getByRole("button", { name: ts("saveTier") }).click();
    await expect(p).toHaveURL(/msg=saved&s=tier-retired/);
    await expect(p.locator("#tier-retired").getByText(ts("hiddenBadge"), { exact: true })).toBeVisible();
    await page.goto("/en/membership");
    await expect(page.locator(".tier h3", { hasText: "Retired / Associate" })).toHaveCount(0);
    await expect(page.locator(".tier")).toHaveCount(3);
    await page.goto("/en/join?tier=retired");
    await expect(page.locator("#tier option[value=retired]")).toHaveCount(0);
    await expect(page.locator("#tier")).toHaveValue("professional"); // falls back to the featured tier
  } finally { await resetBlock(p, "tier.retired"); }
  await page.goto("/en/membership");
  await expect(page.locator(".tier")).toHaveCount(4);
});

test("public contact details card appears on /contact and is cleared again", async ({ adminPage: p, page }) => {
  const email = `e2e-contact-${RUN}@example.test`;
  try {
    await page.goto("/en/contact");
    await expect(page.locator(".site-contact-info")).toHaveCount(0);
    await settings(p);
    await p.locator("#ce").fill(email);
    await p.locator("#pa").fill("E2E House\n1 Test Street\nNew York, NY 10001");
    await p.locator("#site").getByRole("button", { name: ts("saveSite") }).click();
    await expect(p).toHaveURL(/msg=saved&s=site/);
    await page.goto("/en/contact");
    const card = page.locator(".site-contact-info");
    await expect(card.locator("h2")).toHaveText(t("siteInfo.title"));
    await expect(card.getByRole("link", { name: email })).toHaveAttribute("href", `mailto:${email}`);
    await expect(card.locator("address")).toContainText("1 Test Street");
    await page.goto("/fr/contact");
    await expect(page.locator(".site-contact-info h2")).toHaveText(tFr("siteInfo.title"));
    // Invalid email is refused.
    await settings(p);
    await p.locator("#ce").fill("not an email");
    await p.locator("#ce").evaluate((el: HTMLInputElement) => { el.type = "text"; });
    await p.locator("#site").getByRole("button", { name: ts("saveSite") }).click();
    await expect(p).toHaveURL(/msg=invalidEmail/);
    expect(await row("site.contact")).toMatchObject({ value: expect.objectContaining({ contactEmail: email }) });

    await resetBlock(p, "site.contact");
    await page.goto("/en/contact");
    await expect(page.locator(".site-contact-info")).toHaveCount(0);
  } finally { await resetBlock(p, "site.contact"); }
});

test("operational policy: directory opt-in default on the join form", async ({ adminPage: p, page }) => {
  try {
    await page.goto("/en/join");
    await expect(page.locator("input[name=directoryOptIn]")).not.toBeChecked();
    await settings(p);
    await p.locator("#od").selectOption("on");
    await p.locator("#ops").getByRole("button", { name: ts("saveOps") }).click();
    await expect(p).toHaveURL(/msg=saved&s=ops/);
    expect(await row("ops")).toMatchObject({ value: { directoryOptInDefault: true } });
    await page.goto("/en/join");
    await expect(page.locator("input[name=directoryOptIn]")).toBeChecked();
    await resetBlock(p, "ops");
    await page.goto("/en/join");
    await expect(page.locator("input[name=directoryOptIn]")).not.toBeChecked();
  } finally { await resetBlock(p, "ops"); }
});
