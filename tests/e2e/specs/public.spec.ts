/**
 * Public site: every public page in EN and FR (status, console errors, no horizontal overflow at 390px), main navigation
 * (Advisory Board → /governance), governance designations, security headers
 * and CSP nonce, health check, removed routes, staff-only design pages, no language switch (French not offered since round 6b).
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

test("main navigation: Advisory Board opens /governance and is the active item there; the footer no longer links it", async ({ page }) => {
  for (const locale of ["en", "fr"] as const) {
    const nav = page.locator("#primary-nav");
    await page.goto(`/${locale}`);
    const item = nav.getByRole("link", { name: msg("chrome.advisoryBoard", {}, locale), exact: true });
    await expect(item).toHaveAttribute("href", `/${locale}/governance`);
    // Order: right after About.
    await expect(nav.locator("a").nth(0)).toHaveText(msg("chrome.about", {}, locale));
    await expect(nav.locator("a").nth(1)).toHaveText(msg("chrome.advisoryBoard", {}, locale));
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/governance$`));
    await expect(page.locator("main#main h1").first()).toBeVisible();
    await expect(nav.locator("a[aria-current=page]")).toHaveCount(1);
    await expect(nav.locator("a[aria-current=page]")).toHaveText(msg("chrome.advisoryBoard", {}, locale));
    await expect(nav.getByRole("link", { name: msg("chrome.about", {}, locale), exact: true })).not.toHaveAttribute("aria-current", "page");
    // No breadcrumbs anywhere.
    await expect(page.getByRole("navigation", { name: msg("chrome.breadcrumbAria", {}, locale) })).toHaveCount(0);
    await expect(page.locator(".breadcrumb, .breadcrumbs, .crumbs")).toHaveCount(0);
    // Footer: no plain link to the governance page (the "Code of ethics" anchor link remains).
    await expect(page.locator(`.site-footer a[href="/${locale}/governance"]`)).toHaveCount(0);
    await expect(page.locator(".site-footer").getByRole("link", { name: /board|conseil/i })).toHaveCount(0);
  }
  // About stays the active item on its own pages.
  await page.goto("/en/about");
  await expect(page.locator("#primary-nav a[aria-current=page]")).toHaveText(msg("chrome.about"));
});

test("governance page: board designations and officer roles", async ({ page }) => {
  await page.goto("/en/governance");
  const person = (name: string) => page.locator(".ab-person", { has: page.locator("h4", { hasText: name }) });
  await expect(person("Carlos Solari")).toContainText("Chairman – Advisory Board");
  await expect(person("Sowmya Kandregula")).toContainText("Advisory Board Member");
  // No separate Chair officer card: the open officer roles are Treasurer and Secretary.
  await expect(page.locator(".ab-officers li > span:first-child")).toHaveText(["Treasurer", "Secretary"]);
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
  // (/en/admin/content*: the Content admin was removed in round 7; visitors get the public 404, admins the admin 404.)
  for (const p of ["/en/certifications", "/en/learning", "/en/verify", "/en/mfa", "/en/my/credentials", "/en/my/learning", "/en/admin/credentialing", "/en/admin/content", "/en/admin/content/home/en", "/fr/certifications", "/en/no-such-page"]) {
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

test("no language switch is shown, and / with Accept-Language fr stays English @smoke", async ({ page, request }) => {
  // French is not offered (client, round 6b): no EN/FR switch in the utility bar or the menu panel, no automatic French.
  const noSwitch = async () => {
    for (const locale of ["en", "fr"] as const) {
      await expect(page.getByRole("navigation", { name: msg("chrome.langAria", {}, locale), exact: true })).toHaveCount(0);
      await expect(page.getByRole("group", { name: msg("chrome.langAria", {}, locale), exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /Français|^FR\b/ })).toHaveCount(0);
    await expect(page.locator(".lang, .nav-lang")).toHaveCount(0);
  };
  await page.goto("/en/events?q=risk&type=Webinar");
  await expect(page.locator("#es")).toHaveValue("risk");
  await noSwitch();
  // Utility bar: exactly Chapters, Careers, Contact.
  await expect(page.locator(".util a")).toHaveText([msg("chrome.chapters"), msg("chrome.careers"), msg("chrome.contact")]);
  // The menu panel (phones/tablets) has no language row either.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".nav-toggle").click();
  await expect(page.locator("#primary-nav .nav-util a")).toHaveText([msg("chrome.chapters"), msg("chrome.careers"), msg("chrome.contact")]);
  await noSwitch();

  // A French browser (or an old NEXT_LOCALE=fr cookie) lands on /en; no hreflang link header points at /fr.
  for (const headers of [{ "accept-language": "fr-CA,fr;q=0.9" }, { cookie: "NEXT_LOCALE=fr" }] as Record<string, string>[]) {
    const r = await request.get("/", { headers, maxRedirects: 0 });
    expect(r.status(), JSON.stringify(headers)).toBe(307);
    expect(new URL(r.headers()["location"], "http://x").pathname, JSON.stringify(headers)).toBe("/en");
  }
  const en = await request.get("/en", { headers: { "accept-language": "fr" } });
  expect(en.headers()["link"] ?? "").not.toContain('hreflang="fr"');
  await page.setExtraHTTPHeaders({ "accept-language": "fr" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // /fr URLs still work when opened directly (kept for future use), just unlinked.
  const fr = await page.goto("/fr/events");
  expect(fr?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await noSwitch();
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
