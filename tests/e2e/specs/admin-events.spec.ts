/**
 * Admin → Events: create (ET time round-trip), edit, publish/unpublish, registrations list and filters, attendance →
 * CPE credited exactly once, undo, cancel (hidden publicly) / restore, delete, per-event CSV.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, createEvent, createMember, createRegistration, eventById, eventByTitle, one, q, uniqueName, uniqueSlug } from "../support/db";
import { t } from "../support/i18n";

const ta = (k: string, v?: Record<string, string | number>) => t(`admin.${k}`, v);
const te = (k: string, v?: Record<string, string | number>) => t(`adminEvents.${k}`, v);
const manage = (p: Page, id: string) => p.goto(`/en/admin/events/${id}`);
const notice = (p: Page) => p.locator("main .alert").first();
/** The value of the KPI tile with this label (event page). */
const kpi = (p: Page, label: string) => p.locator(".kpi").filter({ has: p.getByText(label, { exact: true }) }).locator(".v");
/** A registrations filter tab (its accessible name is the label followed by the count). */
const regFilter = (p: Page, label: string) => p.getByRole("navigation", { name: te("filterLabel") }).getByRole("link", { name: label });

async function fillNewEvent(p: Page, v: { title: string; startsAt: string; publish?: boolean }) {
  await p.goto("/en/admin/events");
  const f = p.locator("#new-event");
  await f.locator("summary").click(); // "+ New event" opens the form (a disclosure since round 5)
  await f.locator("#ti").fill(v.title);
  // No French fields since round 6b (French is not offered): the form has no #tf/#suf/#aif.
  await expect(f.locator("[name=titleFr], [name=summaryFr], [name=accessInfoFr]")).toHaveCount(0);
  await f.locator("#su").fill("Created by the end-to-end suite.");
  await f.locator("#ty").selectOption("Webinar");
  await f.locator("#fo").selectOption("Online");
  await f.locator("#st").fill(v.startsAt);
  await f.locator("#du").fill("90");
  await f.locator("#cp").fill("1.5");
  await f.locator("#mp").fill("0");
  await f.locator("#pp").fill("25");
  if (v.publish) await f.locator("input[name=publish]").check();
  await f.getByRole("button", { name: ta("create") }).click();
}

test("create: draft event, start time entered in ET is stored as the right instant (EST and EDT)", async ({ adminPage: p, page }) => {
  // Winter (EST, UTC−5): 14:30 ET = 19:30 UTC.
  const winter = uniqueName("Event");
  await fillNewEvent(p, { title: winter, startsAt: "2027-01-15T14:30" });
  await expect(p).toHaveURL(/msg=createdDraft/);
  await expect(notice(p)).toHaveText(ta("ev_createdDraft"));
  const w = (await eventByTitle(winter))!;
  expect(w.startsAt.toISOString()).toBe("2027-01-15T19:30:00.000Z");
  expect(w).toMatchObject({ published: false, durationMin: 90, cpe: 1.5, memberPriceCents: 0, publicPriceCents: 2500, type: "Webinar", format: "Online" });
  expect(w.slug).toMatch(/^e2e-event-/);
  expect(await auditRows({ action: "event.created", target: w.id })).toHaveLength(1);
  // Round trip: the edit form shows the same ET wall-clock time.
  await manage(p, w.id);
  await expect(p.locator("#e-st")).toHaveValue("2027-01-15T14:30");
  await expect(p.locator(".app-head").getByText(ta("draftBadge"), { exact: true })).toBeVisible();
  // Drafts are not public.
  expect((await page.goto(`/en/events/${w.slug}`))?.status()).toBe(404);

  // Summer (EDT, UTC−4), published immediately: 14:30 ET = 18:30 UTC, shown as 2:30 PM ET publicly.
  const summer = uniqueName("Event");
  await fillNewEvent(p, { title: summer, startsAt: "2027-07-15T14:30", publish: true });
  await expect(p).toHaveURL(/msg=createdPublished/);
  const s = (await eventByTitle(summer))!;
  expect(s.startsAt.toISOString()).toBe("2027-07-15T18:30:00.000Z");
  expect(s.published).toBe(true);
  await page.goto(`/en/events/${s.slug}`);
  await expect(page.locator(".ev-dl")).toContainText(`2:30 PM – 4:00 PM ${t("events.tz")}`);
  await expect(page.locator(".ev-dl")).toContainText("Thursday, July 15, 2027");
});

test("edit: every field, slug and publish state are saved; stored French texts are kept and show on /fr", async ({ adminPage: p, page }) => {
  // French is not offered in the form since round 6b, but existing French texts must survive an edit unchanged.
  const titleFr = `${uniqueName("Titre")} FR`;
  const e = await createEvent({ published: false, cpe: 1, titleFr, summaryFr: "Résumé existant de la suite E2E." });
  const title = uniqueName("Edited event"); const slug = uniqueSlug();
  await manage(p, e.id);
  await expect(p.locator("#e-tf, #e-suf, #e-aif")).toHaveCount(0); // no visible French inputs
  await expect(p.locator("#edit input[type=hidden][name=titleFr]")).toHaveValue(titleFr);
  await p.locator("#e-ti").fill(title);
  await p.locator("#e-su").fill("Summary edited by the E2E suite.");
  await p.locator("#e-lo").fill("E2E Hall, New York");
  await p.locator("#e-fo").selectOption("Hybrid");
  await p.locator("#e-st").fill("2027-02-01T09:15");
  await p.locator("#e-cp").fill("2");
  await p.locator("#e-sl").fill(slug);
  await p.locator("#edit input[name=published]").check();
  await p.getByRole("button", { name: te("save") }).click();
  await expect(p).toHaveURL(/msg=saved/);
  await expect(notice(p)).toHaveText(te("msg_saved"));
  const after = (await eventById(e.id))!;
  expect(after).toMatchObject({ title, titleFr, summary: "Summary edited by the E2E suite.", summaryFr: "Résumé existant de la suite E2E.", location: "E2E Hall, New York", format: "Hybrid", cpe: 2, slug, published: true });
  expect(after.startsAt.toISOString()).toBe("2027-02-01T14:15:00.000Z");
  for (const a of ["event.updated", "event.slug_changed", "event.published"]) expect(await auditRows({ action: a, target: e.id }), a).toHaveLength(1);
  await page.goto(`/fr/events/${slug}`);
  await expect(page.locator("h1")).toHaveText(titleFr);
  await expect(page.locator(".lead")).toHaveText("Résumé existant de la suite E2E.");
  await expect(page.locator(".ev-dl")).toContainText("9:15");
  // Invalid input is refused without saving.
  await manage(p, e.id);
  await p.locator("#e-sl").fill("Not A Valid Slug!");
  await p.locator("#e-sl").evaluate((el: HTMLInputElement) => el.removeAttribute("pattern"));
  await p.getByRole("button", { name: te("save") }).click();
  await expect(p).toHaveURL(/msg=slugInvalid/);
  expect((await eventById(e.id))!.slug).toBe(slug);
});

test("publish and unpublish from the list control public visibility", async ({ adminPage: p, page }) => {
  const e = await createEvent({ published: false });
  await p.goto("/en/admin/events");
  await p.getByRole("button", { name: `${ta("publish")}: ${e.title}`, exact: true }).click();
  await expect(p.getByRole("button", { name: `${ta("unpublish")}: ${e.title}`, exact: true })).toBeVisible();
  expect((await eventById(e.id))!.published).toBe(true);
  await page.goto(`/en/events?q=${encodeURIComponent(e.title)}`);
  await expect(page.locator(".event-card").getByRole("link", { name: e.title })).toBeVisible();

  await p.getByRole("button", { name: `${ta("unpublish")}: ${e.title}`, exact: true }).click();
  await expect(p.getByRole("button", { name: `${ta("publish")}: ${e.title}`, exact: true })).toBeVisible();
  expect((await eventById(e.id))!.published).toBe(false);
  expect((await page.goto(`/en/events/${e.slug}`))?.status()).toBe(404);
  expect(await auditRows({ action: "event.published", target: e.id })).toHaveLength(1);
  expect(await auditRows({ action: "event.unpublished", target: e.id })).toHaveLength(1);
});

test("registrations: list, filters, search, attendance credits CPE once, undo removes it, CSV", async ({ adminPage: p, request }) => {
  const e = await createEvent({ cpe: 1.5, startsAt: new Date(Date.now() - 2 * 3600e3) }); // attendance opens at the start time
  const a = await createMember({ name: uniqueName("Attendee A") });
  const b = await createMember({ name: uniqueName("Attendee B") });
  const c = await createMember({ name: uniqueName("Attendee C") });
  await createRegistration(a.id, e.id);
  await createRegistration(b.id, e.id);
  await createRegistration(c.id, e.id, { status: "pending_payment", ticket: "non-member", amountCents: 2500 });
  const cpe = (userId: string) => q<{ hours: number; title: string; status: string }>(`SELECT * FROM "CpeEntry" WHERE "userId" = $1 AND "eventId" = $2`, [userId, e.id]);

  await manage(p, e.id);
  await expect(kpi(p, te("kpiConfirmed"))).toHaveText("2");
  await expect(p.locator(".adm-table-regs tbody tr")).toHaveCount(3);
  await expect(regFilter(p, te("v_pending"))).toHaveAccessibleName(`${te("v_pending")} 1`);
  await regFilter(p, te("v_pending")).click();
  await expect(p.locator(".adm-table-regs tbody tr")).toHaveCount(1);
  await expect(p.locator(".adm-table-regs tbody tr")).toContainText(c.name);
  await manage(p, e.id);
  await p.locator("#rq").fill(b.email.toUpperCase());
  await p.locator("#registrations form[role=search]").getByRole("button").click();
  await expect(p.locator(".adm-table-regs tbody tr")).toHaveCount(1);
  await expect(p.locator(".adm-table-regs tbody tr")).toContainText(b.email);

  // Mark A attended → 1.5 CPE credited.
  await manage(p, e.id);
  await p.getByRole("button", { name: `${te("markAttended")}: ${a.name}` }).click();
  await expect(p).toHaveURL(/msg=attendanceMarked/);
  await expect(p.locator("tbody tr", { hasText: a.name })).toContainText(te("cpeCredited", { cpe: "1.5 CPE" }));
  expect(await cpe(a.id)).toEqual([expect.objectContaining({ hours: 1.5, status: "approved", title: e.title })]);

  // Bulk "select all → attended": B is credited, A is not credited a second time, C (unpaid) is skipped.
  await manage(p, e.id);
  await p.getByLabel(te("selectAll")).check();
  await p.getByRole("button", { name: te("bulkAttended") }).click();
  await expect(p).toHaveURL(/msg=attendancePartial/);
  expect(await cpe(a.id)).toHaveLength(1);
  expect(await cpe(b.id)).toHaveLength(1);
  expect(await cpe(c.id)).toHaveLength(0);
  await expect(kpi(p, te("kpiAttended"))).toHaveText("2");

  // Undo A → the automatic CPE entry is removed, B keeps theirs.
  await manage(p, e.id);
  await p.getByRole("button", { name: `${te("unmark")}: ${a.name}` }).click();
  await expect(p).toHaveURL(/msg=attendanceUnmarked/);
  expect(await cpe(a.id)).toHaveLength(0);
  expect(await cpe(b.id)).toHaveLength(1);
  expect((await one<{ attended: boolean }>(`SELECT attended FROM "Registration" WHERE "userId" = $1 AND "eventId" = $2`, [a.id, e.id]))!.attended).toBe(false);

  // Per-event CSV: admins only; includes the credited hours.
  const csv = await p.request.get(`/api/admin/events/${e.id}/registrations.csv`);
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body.split("\n")).toHaveLength(4);
  expect(body.split("\n").find((l) => l.includes(b.email))).toMatch(/"true","1\.5"$/);
  expect((await request.get(`/api/admin/events/${e.id}/registrations.csv`)).status()).toBe(403);
});

test("cancel hides the event publicly and blocks deletion; restore brings it back as a draft", async ({ adminPage: p, page }) => {
  const e = await createEvent();
  const m = await createMember();
  await createRegistration(m.id, e.id);
  await manage(p, e.id);
  await expect(p.locator("#danger")).toContainText(te("deleteBlocked"));
  await p.locator("#danger summary", { hasText: te("cancelBtn") }).click();
  await p.getByRole("button", { name: te("cancelYes") }).click();
  await expect(p).toHaveURL(/msg=cancelled/);
  await expect(notice(p)).toHaveText(te("msg_cancelled"));
  await expect(p.locator(".app-head").getByText(te("cancelledBadge"), { exact: true })).toBeVisible();
  const c = (await eventById(e.id))!;
  expect(c.cancelledAt).toBeTruthy();
  expect(c.published).toBe(false);
  expect((await page.goto(`/en/events/${e.slug}`))?.status()).toBe(404);
  await page.goto(`/en/events?q=${encodeURIComponent(e.title)}`);
  await expect(page.getByRole("heading", { name: t("events.empty") })).toBeVisible();
  // The registration is kept, and the member's upcoming list no longer shows the event.
  expect(await one(`SELECT id FROM "Registration" WHERE "eventId" = $1`, [e.id])).toBeTruthy();
  // Cancelled events cannot be published from the list.
  await p.goto("/en/admin/events");
  await expect(p.getByRole("button", { name: `${ta("publish")}: ${e.title}`, exact: true })).toHaveCount(0);

  await manage(p, e.id);
  await p.getByRole("button", { name: te("restoreBtn") }).click();
  await expect(p).toHaveURL(/msg=restored/);
  await expect(notice(p)).toHaveText(te("msg_restored"));
  const r = (await eventById(e.id))!;
  expect(r.cancelledAt).toBeNull();
  expect(r.published).toBe(false);
  expect(await auditRows({ action: "event.cancelled", target: e.id })).toHaveLength(1);
  expect(await auditRows({ action: "event.restored", target: e.id })).toHaveLength(1);
});

test("delete an event without registrations", async ({ adminPage: p }) => {
  const e = await createEvent({ published: false });
  await manage(p, e.id);
  await p.locator("#danger summary", { hasText: te("deleteBtn") }).click();
  await p.getByRole("button", { name: te("deleteYes") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/events\?msg=deleted/);
  await expect(notice(p)).toHaveText(te("msg_deleted"));
  expect(await eventById(e.id)).toBeUndefined();
  expect(await auditRows({ action: "event.deleted", target: e.id })).toHaveLength(1);
  expect((await p.goto(`/en/admin/events/${e.id}`))?.status()).toBe(404);
});

test("impossible ET start times are refused (DST gap, invalid day)", async ({ adminPage: p }) => {
  // 2027-03-14 02:30 does not exist in New York (clocks jump from 02:00 to 03:00).
  const title = uniqueName("Event");
  await fillNewEvent(p, { title, startsAt: "2027-03-14T02:30" });
  await expect(p).toHaveURL(/msg=invalid/);
  expect(await eventByTitle(title)).toBeUndefined();
});
