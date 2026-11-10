/** Member area: dashboard pages, profile edit, data export (JSON/CSV), self-service deletion, member directory opt-in. */
import { test, expect, watchConsole, expectNoHorizontalOverflow, expectLoginRefused } from "../fixtures";
import { createEvent, createMember, createRegistration, createUser, membershipsOf, one, userById, uniqueName } from "../support/db";
import { t } from "../support/i18n";

test("member area pages render for the seed member (no overflow at 390px) @smoke", async ({ memberPage: p }) => {
  const errors = watchConsole(p);
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/en/my/dashboard", "/en/my/billing", "/en/my/profile", "/en/my/events", "/en/my/community", "/en/my/directory", "/fr/my/dashboard"]) {
    const r = await p.goto(path);
    expect(r?.status(), path).toBe(200);
    await expect(p.locator("main#main h1"), path).toBeVisible();
    await expectNoHorizontalOverflow(p, path);
  }
  await p.goto("/en/my/dashboard");
  await expect(p.locator("h1")).toHaveText("Jordan Member");
  await expect(p.locator(".mbr-kpis")).toContainText("Professional");
  expect(errors).toEqual([]);
});

test("profile edit is saved and shown on the dashboard", async ({ loginAs }) => {
  const m = await createMember();
  const p = await loginAs(m);
  const name = uniqueName("Renamed");
  await p.goto("/en/my/profile");
  await expect(p.locator("#e")).toHaveValue(m.email);
  await expect(p.locator("#e")).toBeDisabled();
  await p.locator("#n").fill(name);
  await p.locator("#o").fill("E2E New Org");
  await p.locator("#j").fill("E2E Data Steward");
  await p.locator("#l").selectOption("fr");
  await p.locator("input[name=marketingOptIn]").check();
  await p.getByRole("button", { name: t("profile.save") }).click();
  await expect(p).toHaveURL(/\/en\/my\/profile\?saved=1/);
  await expect(p.locator("main").getByRole("status")).toHaveText(t("profile.saved"));
  expect(await userById(m.id)).toMatchObject({ name, organisation: "E2E New Org", jobTitle: "E2E Data Steward", locale: "fr", marketingOptIn: true, email: m.email });
  await p.goto("/en/my/dashboard");
  await expect(p.locator("h1")).toHaveText(name);
  await expect(p.locator(".mbr-dl")).toContainText("E2E Data Steward");
});

test("data export: JSON and CSV contain my data and never the password hash", async ({ loginAs, request }) => {
  const m = await createMember({ jobTitle: "E2E Exporter" });
  const ev = await createEvent();
  await createRegistration(m.id, ev.id);
  const p = await loginAs(m);

  const json = await p.request.get("/api/me/export");
  expect(json.status()).toBe(200);
  expect(json.headers()["content-type"]).toContain("application/json");
  expect(json.headers()["content-disposition"]).toContain("adaig-my-data.json");
  expect(json.headers()["cache-control"]).toContain("no-store"); // personal data must not be cached
  const text = await json.text();
  const data = JSON.parse(text);
  expect(data).toMatchObject({ id: m.id, email: m.email, name: m.name, jobTitle: "E2E Exporter" });
  expect(data.memberships).toHaveLength(1);
  expect(data.registrations[0].event.title).toBe(ev.title);
  expect(data).not.toHaveProperty("passwordHash");
  expect(data).not.toHaveProperty("sessionVersion");
  expect(text).not.toMatch(/\$2[aby]\$/);

  const csv = await p.request.get("/api/me/export?format=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["cache-control"]).toContain("no-store");
  const body = await csv.text();
  expect(body.split("\n")[0]).toBe('"section","field","value"');
  expect(body).toContain(`"profile","email","${m.email}"`);
  expect(body).toContain('"membership_1","status","active"');
  expect(body).not.toMatch(/passwordHash|sessionVersion|\$2[aby]\$/);

  // The profile page's download link delivers the same file.
  await p.goto("/en/my/profile");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: t("profile.export") }).click()]);
  expect(dl.suggestedFilename()).toBe("adaig-my-data.json");

  // Not signed in → 401.
  const anon = await request.get("/api/me/export");
  expect(anon.status()).toBe(401);
});

test("self-service account deletion needs the password, anonymizes the account and signs out", async ({ loginAs, page }) => {
  const m = await createMember();
  const ev = await createEvent();
  await createRegistration(m.id, ev.id);
  const p = await loginAs(m);
  await p.goto("/en/my/profile");
  const del = p.locator("form.mbr-danger");
  await del.locator("#dp").fill("Not-my-password-1");
  await del.locator("input[name=confirm]").check();
  await del.getByRole("button", { name: t("profile.deleteBtn") }).click();
  await expect(p).toHaveURL(/del=wrong/);
  await expect(p.locator("main").getByRole("alert")).toHaveText(t("profile.deleteWrong"));
  expect((await userById(m.id))!.role).toBe("member");

  await p.locator("form.mbr-danger #dp").fill(m.password);
  await p.locator("form.mbr-danger input[name=confirm]").check();
  await p.locator("form.mbr-danger").getByRole("button", { name: t("profile.deleteBtn") }).click();
  await expect(p).toHaveURL(/\/en\/login\?deleted=1/);
  await expect(p.locator("main").getByRole("status")).toHaveText(t("profile.deleted"));

  const u = await userById(m.id);
  expect(u).toMatchObject({ role: "deleted", email: `deleted-${m.id}@deleted.invalid`, name: "Deleted member", organisation: null, directoryOptIn: false });
  expect(u!.deletedAt).toBeTruthy();
  const [ms] = await membershipsOf(m.id);
  expect(ms).toMatchObject({ status: "cancelled", activeSlot: null });
  expect(await one(`SELECT id FROM "Registration" WHERE "userId" = $1`, [m.id])).toBeUndefined(); // free registration removed
  await p.goto("/en/my/dashboard");
  await expect(p).toHaveURL(/\/en\/login/);
  // The old credentials no longer work.
  await page.goto("/en/login");
  await page.locator("#le").fill(m.email); await page.locator("#lp").fill(m.password);
  await page.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(page, t("auth.invalid"), { email: m.email });
});

test.describe("member directory", () => {
  test("lists only active members who opted in; opting in from the profile adds me", async ({ loginAs }) => {
    const me = await createMember({ name: uniqueName("Dir Me") });
    const listed = await createMember({ name: uniqueName("Dir Listed"), directoryOptIn: true, jobTitle: "E2E Archivist" });
    const notMember = await createUser({ name: uniqueName("Dir Guest"), directoryOptIn: true });
    const p = await loginAs(me);
    const search = async (q: string) => { await p.goto(`/en/my/directory?q=${encodeURIComponent(q)}`); return p.locator(".mbr-people .member-card"); };

    await expect(await search(listed.name)).toHaveCount(1);
    await expect(p.locator(".mbr-people")).toContainText("E2E Archivist");
    await expect(await search(notMember.name), "guests are never listed").toHaveCount(0);
    await expect(await search(me.name), "not listed before opting in").toHaveCount(0);
    await expect(p.getByRole("note")).toContainText(t("member.directoryPage.youHidden"));

    await p.goto("/en/my/profile");
    await p.locator("input[name=directoryOptIn]").check();
    await p.getByRole("button", { name: t("profile.save") }).click();
    await expect(p).toHaveURL(/saved=1/);
    const cards = await search(me.name);
    await expect(cards).toHaveCount(1);
    await expect(cards.locator(".badge")).toHaveText(t("member.directoryPage.you"));
    await expect(p.getByRole("note")).toContainText(t("member.directoryPage.youListed"));
  });

  test("is only browsable by active members", async ({ loginAs }) => {
    const g = await createUser();
    const p = await loginAs(g);
    await p.goto("/en/my/directory");
    await expect(p.locator(".mbr-empty")).toContainText(t("member.directoryPage.membersOnly"));
    await expect(p.locator(".mbr-people")).toHaveCount(0);
  });
});
