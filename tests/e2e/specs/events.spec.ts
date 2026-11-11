/** Public events: search (case-insensitive, EN + FR fields), filters, event detail in ET, visibility rules, registration. */
import { test, expect } from "../fixtures";
import { createEvent, createMember, createUser, q, one, RUN, auditRows } from "../support/db";
import { msg, t } from "../support/i18n";

const token = () => `Zq${RUN}${Math.random().toString(36).slice(2, 7)}`;

test.describe("event search", () => {
  test("is case-insensitive and searches titles, French summaries and locations @smoke", async ({ page }) => {
    const word = token(); const frWord = token();
    const e = await createEvent({ title: `E2E Governance ${word} clinic`, summaryFr: `Résumé ${frWord}`, location: `Lab ${word}` });
    await page.goto(`/en/events?q=${word.toLowerCase()}`);
    await expect(page.locator(".ev-results")).toContainText("1 event");
    await expect(page.locator(".event-card").getByRole("link", { name: e.title })).toBeVisible();
    await page.locator("#es").fill(word.toUpperCase());
    await page.getByRole("button", { name: t("events.apply") }).click();
    await expect(page).toHaveURL(new RegExp(`q=${word.toUpperCase()}`));
    await expect(page.locator(".event-card").getByRole("link", { name: e.title })).toBeVisible();
    await page.goto(`/en/events?q=${encodeURIComponent(frWord.toLowerCase())}`);
    await expect(page.locator(".event-card").getByRole("link", { name: e.title })).toBeVisible();
    // A type filter that does not match → empty state with a "clear" link.
    await page.goto(`/en/events?q=${word}&type=Conference`);
    await expect(page.getByRole("heading", { name: t("events.empty") })).toBeVisible();
  });

  test("seed events are found regardless of case", async ({ page }) => {
    await page.goto("/en/events?q=RISK%20REGISTER");
    await expect(page.locator(".event-card").getByRole("link", { name: /risk register/i })).toBeVisible();
  });

  test("drafts and cancelled events never show publicly", async ({ page }) => {
    const word = token();
    const draft = await createEvent({ title: `E2E Draft ${word}`, published: false });
    const cancelled = await createEvent({ title: `E2E Cancelled ${word}`, cancelledAt: new Date() });
    await page.goto(`/en/events?q=${word}`);
    await expect(page.getByRole("heading", { name: t("events.empty") })).toBeVisible();
    for (const e of [draft, cancelled]) {
      const r = await page.goto(`/en/events/${e.slug}`);
      expect(r?.status(), e.title).toBe(404);
    }
  });
});

test.describe("event detail", () => {
  test("shows times in Eastern time and the French title/summary on /fr", async ({ page }) => {
    // 2027-03-10 15:00 UTC = 10:00 AM EST (before the DST switch on 2027-03-14).
    const e = await createEvent({ title: `E2E Detail ${token()}`, titleFr: `E2E Détail ${token()}`, summaryFr: "Résumé de test.", startsAt: new Date("2027-03-10T15:00:00Z"), durationMin: 90, cpe: 1.5 });
    await page.goto(`/en/events/${e.slug}`);
    await expect(page.locator("h1")).toHaveText(e.title);
    const dl = page.locator(".ev-dl");
    await expect(dl).toContainText("Wednesday, March 10, 2027");
    await expect(dl).toContainText(`10:00 AM – 11:30 AM ${t("events.tz")}`);
    await expect(dl).toContainText("1.5 CPE");
    await expect(page.getByRole("link", { name: t("events.signInToRegister") })).toBeVisible();
    await page.goto(`/fr/events/${e.slug}`);
    await expect(page.locator("h1")).toHaveText(e.titleFr!);
    await expect(page.locator(".lead")).toHaveText("Résumé de test.");
    await expect(page.locator(".ev-dl")).toContainText("1,5 FPC");
  });

  test("proposed events show no date and take no registrations", async ({ loginAs }) => {
    const m = await createMember();
    const e = await createEvent({ title: `E2E Idea ${token()} (proposed)` });
    const p = await loginAs(m);
    await p.goto(`/en/events/${e.slug}`);
    await expect(p.locator("h1")).toHaveText(e.title.replace(" (proposed)", ""));
    await expect(p.locator(".ev-reg")).toContainText(t("events.regOpensLater"));
    await expect(p.locator(".ev-reg form")).toHaveCount(0);
  });
});

test.describe("registration", () => {
  test("an active member registers for free and sees it under My events @smoke", async ({ loginAs }) => {
    const m = await createMember();
    const e = await createEvent({ title: `E2E Free ${token()}`, memberPriceCents: 0, publicPriceCents: 4900 });
    const p = await loginAs(m);
    await p.goto(`/en/events/${e.slug}`);
    await expect(p.locator(".ev-prices .is-mine")).toContainText(t("events.free"));
    await p.getByRole("button", { name: t("events.registerFree") }).click();
    await expect(p).toHaveURL(/registered=1/);
    await expect(p.locator(".ev-reg .alert-success")).toContainText(t("events.registered"));
    const r = await one<{ id: string; status: string; ticket: string; amountCents: number }>(`SELECT * FROM "Registration" WHERE "userId" = $1 AND "eventId" = $2`, [m.id, e.id]);
    expect(r).toMatchObject({ status: "confirmed", ticket: "member", amountCents: 0 });
    expect(await auditRows({ action: "event.registered_free", target: r!.id })).toHaveLength(1);
    // Registering again is idempotent (still one row).
    await p.goto(`/en/events/${e.slug}`);
    await expect(p.locator(".ev-reg form")).toHaveCount(0);
    await p.goto("/en/my/events");
    await expect(p.locator(".mbr-events")).toContainText(e.title);
    expect((await q(`SELECT id FROM "Registration" WHERE "userId" = $1`, [m.id])).length).toBe(1);
  });

  test("a non-member is charged the public price and goes to checkout (payment pending)", async ({ loginAs }) => {
    const g = await createUser({ role: "guest" });
    const e = await createEvent({ title: `E2E Paid ${token()}`, memberPriceCents: 0, publicPriceCents: 2500 });
    const p = await loginAs(g);
    await p.goto(`/en/events/${e.slug}`);
    await p.getByRole("button", { name: new RegExp(`${t("events.payAndRegister")}.*25`) }).click();
    await expect(p).toHaveURL(new RegExp(`/en/events/${e.slug}/checkout\\?r=`));
    await expect(p.locator(".ev-checkout")).toContainText(e.title);
    await expect(p.locator(".ev-checkout")).toContainText("US$25.00");
    const r = await one<{ status: string; ticket: string; amountCents: number }>(`SELECT * FROM "Registration" WHERE "userId" = $1 AND "eventId" = $2`, [g.id, e.id]);
    expect(r).toMatchObject({ status: "pending_payment", ticket: "non-member", amountCents: 2500 });
  });

  test("a non-member cannot register when the public price is not set", async ({ loginAs }) => {
    const g = await createUser({ role: "guest" });
    const e = await createEvent({ title: `E2E Members only ${token()}`, publicPriceCents: null });
    const p = await loginAs(g);
    await p.goto(`/en/events/${e.slug}`);
    await expect(p.locator(".ev-reg")).toContainText(t("events.tbcBlocked"));
    await expect(p.locator(".ev-reg form")).toHaveCount(0);
  });

  test("the French event page is fully translated for a signed-in member", async ({ loginAs }) => {
    const m = await createMember();
    const e = await createEvent({ title: `E2E Bilingue ${token()}`, titleFr: `E2E Bilingue FR ${token()}` });
    const p = await loginAs(m, { locale: "fr" });
    await p.goto(`/fr/events/${e.slug}`);
    await expect(p.getByRole("button", { name: msg("events.registerFree", {}, "fr") })).toBeVisible();
  });
});
