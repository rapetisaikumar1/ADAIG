/**
 * Admin → Content: edit a page → visible publicly → revision history → restore → return to the original (public HTML
 * identical to before); the sanitizer strips scripts, event handlers and javascript: URLs.
 * Every test resets its page through the admin UI in `finally`, which also expires the app's content cache.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, count, one, RUN } from "../support/db";
import { t } from "../support/i18n";

const tc = (k: string, v?: Record<string, string | number>) => t(`adminContent.${k}`, v);
const SLUG = "careers"; // a whole-page ("page" kind) content page with no French file (FR falls back to EN)
const editor = (p: Page) => p.goto(`/en/admin/content/${SLUG}/en`);
const publicMain = async (p: Page, locale = "en") => { await p.goto(`/${locale}/${SLUG}`); return p.locator("main#main").innerHTML(); };
const pageRow = () => one<{ id: string; html: string }>(`SELECT id, html FROM "ContentPage" WHERE slug = $1 AND locale = 'en'`, [SLUG]);

async function save(p: Page, html: string) {
  await editor(p);
  await p.locator("#cm-html").fill(html);
  await p.locator(".cm-editor").getByRole("button", { name: tc("save") }).click();
  await expect(p).toHaveURL(/msg=saved/);
}
/** Back to the original through the UI (no-op when the page is not edited). */
async function resetToOriginal(p: Page) {
  if (!(await pageRow())) return;
  await editor(p);
  await p.locator(".cm-reset summary").click();
  await p.getByRole("button", { name: tc("resetYes") }).click();
  await expect(p).toHaveURL(/msg=reset/);
}

test.beforeEach(async ({ adminPage }) => { adminPage.on("dialog", (d) => d.accept().catch(() => {})); });

test("edit → public page → history → restore → return to the original", async ({ adminPage: p, page }) => {
  const original = await publicMain(page);
  const originalFr = await publicMain(page, "fr");
  try {
    await editor(p);
    await expect(p.locator(".cm-status")).toContainText(tc("stOriginal"));
    const source = await p.locator("#cm-html").inputValue();
    const v1 = `<p id="e2e-v1">E2E content v1 ${RUN}</p>`, v2 = `<p id="e2e-v2">E2E content v2 ${RUN}</p>`;

    await save(p, source + v1);
    await expect(p.locator("main .alert-success")).toContainText(tc("msg_saved"));
    await expect(p.locator(".cm-status .badge")).toHaveText(tc("stEdited"));
    await expect(p.locator(".cm-rev-table tbody tr")).toHaveCount(1);
    await page.goto(`/en/${SLUG}`);
    await expect(page.locator("#e2e-v1")).toHaveText(`E2E content v1 ${RUN}`);
    // The French page has no translation file, so it shows the edited English page.
    await page.goto(`/fr/${SLUG}`);
    await expect(page.locator("#e2e-v1")).toBeVisible();
    expect(await auditRows({ action: "content.page_saved", target: `en/${SLUG}` })).not.toHaveLength(0);

    await save(p, source + v2);
    await expect(p.locator(".cm-rev-table tbody tr")).toHaveCount(2);
    await page.goto(`/en/${SLUG}`);
    await expect(page.locator("#e2e-v2")).toBeVisible();
    await expect(page.locator("#e2e-v1")).toHaveCount(0);

    // Restore v1 from the history (the only non-current revision).
    await editor(p);
    await p.locator(".cm-rev-table").getByRole("button", { name: new RegExp(`^${tc("restore")}: `) }).click();
    await expect(p).toHaveURL(/msg=restored/);
    await expect(p.locator(".cm-rev-table tbody tr")).toHaveCount(3);
    await page.goto(`/en/${SLUG}`);
    await expect(page.locator("#e2e-v1")).toBeVisible();
    await expect(page.locator("#e2e-v2")).toHaveCount(0);

    // Return to the original: override and revisions are deleted and the public HTML is exactly the original again.
    await resetToOriginal(p);
    await expect(p.locator("main .alert-success")).toContainText(tc("msg_reset"));
    await expect(p.locator(".cm-status")).toContainText(tc("stOriginal"));
    expect(await pageRow()).toBeUndefined();
    expect(await count(`SELECT count(*) AS n FROM "ContentRevision" r JOIN "ContentPage" c ON c.id = r."pageId" WHERE c.slug = $1`, [SLUG])).toBe(0);
    expect(await publicMain(page)).toBe(original);
    expect(await publicMain(page, "fr")).toBe(originalFr);
  } finally { await resetToOriginal(p); }
});

test("the sanitizer removes scripts, event handlers and javascript: URLs", async ({ adminPage: p, page }) => {
  try {
    await editor(p);
    const source = await p.locator("#cm-html").inputValue();
    const evil = `<p id="e2e-safe">E2E safe ${RUN}</p><script>window.__e2eXss = 1</script>`
      + `<img id="e2e-img" src="/assets/mark.svg" alt="" onerror="window.__e2eXss = 2" onload="window.__e2eXss = 3">`
      + `<a id="e2e-js" href="javascript:window.__e2eXss = 4">bad link</a><a id="e2e-js2" href="&#106;avascript:alert(1)">encoded</a>`
      + `<div id="e2e-style" style="background:url(javascript:alert(1))">styled</div><iframe src="https://example.com"></iframe>`;
    await save(p, source + evil);
    const warn = p.locator("main .alert-warning");
    await expect(warn).toContainText(tc("removedSaved"));
    await expect(warn).toContainText("<script>");
    await expect(warn).toContainText("onerror");

    const stored = (await pageRow())!.html;
    expect(stored).toContain('id="e2e-safe"');
    for (const bad of ["<script", "onerror", "onload", "javascript:", "&#106;avascript", "<iframe", "__e2eXss"]) expect(stored, bad).not.toContain(bad);

    await page.goto(`/en/${SLUG}`);
    await expect(page.locator("#e2e-safe")).toBeVisible();
    await expect(page.locator("#e2e-img")).toHaveCount(1);
    await expect(page.locator("#e2e-js")).not.toHaveAttribute("href", /javascript/i);
    await expect(page.locator("#e2e-js2")).not.toHaveAttribute("href", /avascript/i);
    await expect(page.locator("#e2e-style")).not.toHaveAttribute("style", /javascript/i);
    await expect(page.locator("main iframe")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __e2eXss?: number }).__e2eXss)).toBeUndefined();
  } finally { await resetToOriginal(p); }
});

test("the homepage keeps its live events marker", async ({ adminPage: p }) => {
  await p.goto("/en/admin/content/home/en");
  const source = await p.locator("#cm-html").inputValue();
  expect(source).toContain("<!--HOME_EVENTS-->");
  await p.locator("#cm-html").fill(source.replace("<!--HOME_EVENTS-->", ""));
  await p.locator(".cm-editor").getByRole("button", { name: tc("save") }).click();
  await expect(p.locator(".cm-editor .alert-danger")).toHaveText(tc("err_marker", { marker: "<!--HOME_EVENTS-->" }));
  expect(await one(`SELECT id FROM "ContentPage" WHERE slug = 'home'`)).toBeUndefined();
});

test("the homepage events marker must be a real marker, not hidden inside an attribute", async ({ adminPage: p }) => {
  await p.goto("/en/admin/content/home/en");
  const source = await p.locator("#cm-html").inputValue();
  await p.locator("#cm-html").fill(source.replace("<!--HOME_EVENTS-->", '<p data-e2e="<!--HOME_EVENTS-->">E2E</p>'));
  await p.locator(".cm-editor").getByRole("button", { name: tc("save") }).click();
  await expect(p.locator(".cm-editor .alert-danger")).toBeVisible();
  expect(await one(`SELECT id FROM "ContentPage" WHERE slug = 'home'`)).toBeUndefined();
});
