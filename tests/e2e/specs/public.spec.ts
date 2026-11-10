/**
 * Public site: every public page in EN and FR (status, console errors, no horizontal overflow at 390px), security headers
 * and CSP nonce, health check, removed routes, staff-only design pages, language switch.
 */
import { test, expect, watchConsole } from "../fixtures";
import { msg } from "../support/i18n";

const PUBLIC_PATHS = [
  "", "/about", "/principles", "/governance", "/community", "/chapters", "/resources", "/news", "/advocacy", "/careers",
  "/vendors", "/legal", "/membership", "/join", "/events", "/events/ai-risk-register", "/contact", "/login", "/signup",
];

test.describe("public pages", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const locale of ["en", "fr"] as const) {
    for (const p of PUBLIC_PATHS) {
      test(`${locale}${p || "/"} renders without errors or overflow at 390px`, async ({ page }) => {
        const errors = watchConsole(page);
        const res = await page.goto(`/${locale}${p}`, { waitUntil: "load" });
        expect(res?.status(), "HTTP status").toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("main#main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
        expect(overflow.doc, `page is ${overflow.doc}px wide in a ${overflow.view}px viewport`).toBeLessThanOrEqual(overflow.view + 1);
        expect(errors, "console / page errors").toEqual([]);
      });
    }
  }
});

test("root redirects to the default locale @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('main#main')).toBeVisible();
  await expect(page.locator('a[href="/en/join"]', { hasText: msg("chrome.join") }).first()).toBeAttached(); // in the menu on phones
});

test("security headers and per-request CSP nonce", async ({ request }) => {
  const a = await request.get("/en"); const b = await request.get("/en");
  expect(a.status()).toBe(200);
  const h = a.headers();
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("camera=()");
  expect(h["x-powered-by"]).toBeUndefined();
  const csp = h["content-security-policy"];
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce, `CSP has a nonce: ${csp}`).toBeTruthy();
  const scriptSrc = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("script-src"))!;
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // Every script tag in the HTML carries this response's nonce; a second request gets a different one.
  const html = await a.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s, "script tag has the CSP nonce").toContain(`nonce="${nonce}"`);
  expect(/'nonce-([^']+)'/.exec(b.headers()["content-security-policy"])?.[1]).not.toBe(nonce);
});

test("API routes get the strict fallback CSP; /api/health reports the database", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true, db: "up" });
  expect(r.headers()["cache-control"]).toContain("no-store");
  expect(r.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
});

test("removed and unknown routes return 404", async ({ request }) => {
  for (const p of ["/en/certifications", "/en/learning", "/en/verify", "/en/mfa", "/en/my/credentials", "/en/my/learning", "/en/admin/credentialing", "/fr/certifications", "/en/no-such-page"]) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect(r.status(), p).toBe(404);
  }
  // An unknown locale prefix is treated as a path under the default locale (/de/about → /en/de/about) and ends in 404.
  expect((await request.get("/de/about")).status()).toBe(404);
});

test.describe("design reference pages are admin-only", () => {
  for (const p of ["/en/design/brand", "/en/design/components"]) {
    test(`${p}: visitors and members are sent home, admins see it`, async ({ page, memberPage, adminPage }) => {
      await page.goto(p); await expect(page).toHaveURL(/\/en$/);
      await memberPage.goto(p); await expect(memberPage).toHaveURL(/\/en$/);
      const res = await adminPage.goto(p);
      expect(res?.status()).toBe(200);
      await expect(adminPage).toHaveURL(new RegExp(`${p}$`));
      await expect(adminPage.locator("main#main h1").first()).toBeVisible();
    });
  }
});

test("language switch keeps the path and query string @smoke", async ({ page }) => {
  await page.goto("/en/events?q=risk&type=Webinar");
  await expect(page.locator("#es")).toHaveValue("risk");
  await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "FR" }).click();
  await expect(page).toHaveURL(/\/fr\/events\?q=risk&type=Webinar$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("#es")).toHaveValue("risk");
  await expect(page.locator("#et")).toHaveValue("Webinar");
  await expect(page.locator("h1")).toHaveText(msg("events.title", {}, "fr"));
  await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "EN" }).click();
  await expect(page).toHaveURL(/\/en\/events\?q=risk&type=Webinar$/);
});

test("mobile menu opens and closes @smoke", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the menu toggle is only shown on small screens");
  await page.goto("/en");
  const toggle = page.locator(".nav-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#primary-nav")).toHaveClass(/open/);
  await expect(page.locator("#primary-nav").getByRole("link", { name: msg("chrome.events") })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
