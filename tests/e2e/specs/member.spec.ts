/** Member area: My membership (member home) and the other member pages, /my/dashboard redirect, profile edit (incl. country/state, inline errors, forged fields), the read-only membership summary on the profile, data export (JSON/CSV), self-service deletion, member directory opt-in. */
import { test, expect, watchConsole, expectNoHorizontalOverflow, expectLoginRefused, membershipCard, membershipStatus } from "../fixtures";
import { createAdminRole, createEvent, createMember, createMembership, createRegistration, createUser, count, membershipsOf, one, q, userById, uniqueName } from "../support/db";
import { t, tFr } from "../support/i18n";

test("member area pages render for the seed member (no overflow at 390px) @smoke", async ({ memberPage: p }) => {
  const errors = watchConsole(p);
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/en/my/dashboard", "/en/my/billing", "/en/my/profile", "/en/my/events", "/en/my/community", "/en/my/directory", "/fr/my/dashboard"]) {
    const r = await p.goto(path);
    expect(r?.status(), path).toBe(200);
    await expect(p.locator("main#main h1"), path).toBeVisible();
    await expectNoHorizontalOverflow(p, path);
  }
  await p.goto("/en/my/billing");
  await expect(p.locator("main#main h1")).toHaveText(t("member.billingPage.title"));
  await expect(p.locator(".app-head")).toContainText("Jordan Member");
  await expect(membershipCard(p)).toContainText("Professional");
  await expect(membershipStatus(p, "st_active")).toBeVisible();
  expect(errors).toEqual([]);
});

test("/my/dashboard is no longer a page: it redirects to My membership and keeps the query string", async ({ memberPage: p }) => {
  await p.goto("/en/my/dashboard");
  await expect(p).toHaveURL(/\/en\/my\/billing$/);
  await p.goto("/fr/my/dashboard?already=1&msg=orderClosed");
  await expect(p).toHaveURL(/\/fr\/my\/billing\?already=1&msg=orderClosed$/);
  await expect(p.locator("main").getByRole("status").filter({ hasText: tFr("dash.alreadyMember") })).toBeVisible();
  // Nothing links to it any more.
  await expect(p.locator('a[href$="/my/dashboard"]')).toHaveCount(0);
});

test("profile edit is saved and the new name greets me on My membership", async ({ loginAs }) => {
  const m = await createMember({ locale: "fr" }); // stored preference from before round 6b: must survive a save
  const p = await loginAs(m);
  const name = uniqueName("Renamed");
  await p.goto("/en/my/profile");
  await expect(p.locator("#e")).toHaveValue(m.email);
  // The email cannot be edited here: read-only (round 5 uses readOnly instead of disabled, so it stays readable and
  // focusable) and never submitted (no name). The saved row below keeps the original email.
  await expect(p.locator("#e")).not.toBeEditable();
  await expect(p.locator("#e")).toHaveAttribute("readonly", "");
  await expect(p.locator("#e")).not.toHaveAttribute("name");
  await p.locator("#n").fill(name);
  await p.locator("#o").fill("E2E New Org");
  await p.locator("#j").fill("E2E Data Steward");
  // No "Preferred language" choice (French is not offered since round 6b); the stored value is re-submitted unchanged.
  await expect(p.locator("#l, select[name=prefLocale]")).toHaveCount(0);
  // Country + state (round 7): the state list follows the country (Canada → provinces).
  await expect(p.locator("#pf-country")).toHaveValue("United States");
  await p.locator("#pf-country").selectOption("Canada");
  await expect(p.locator("label[for=pf-prov]")).toHaveText(t("join.province"));
  await p.locator("#pf-prov").selectOption("ON");
  await p.locator("input[name=marketingOptIn]").check();
  // Forged fields are ignored: the action only reads the profile fields, and the account is the session's.
  await p.locator("form:has(#n)").evaluate((f) => { for (const [k, v] of [["email", "forged@example.test"], ["role", "admin"], ["id", "someone-else"], ["tierId", "student"], ["status", "active"]]) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.append(i); } });
  await p.getByRole("button", { name: t("profile.save") }).click();
  await expect(p).toHaveURL(/\/en\/my\/profile\?saved=1/);
  await expect(p.locator("main").getByRole("status").filter({ hasText: t("profile.saved") })).toBeVisible();
  expect(await userById(m.id)).toMatchObject({ name, organisation: "E2E New Org", jobTitle: "E2E Data Steward", country: "Canada", province: "ON", locale: "fr", marketingOptIn: true, email: m.email, role: "member" });
  await p.reload();
  await expect(p.locator("#n")).toHaveValue(name);
  await expect(p.locator("#j")).toHaveValue("E2E Data Steward");
  await expect(p.locator("#pf-prov")).toHaveValue("ON");
  await p.goto("/en/my/billing");
  await expect(p.locator("main#main h1")).toHaveText(t("member.billingPage.title"));
  await expect(p.locator(".app-head")).toContainText(name);
});

test("fields that can't be saved get an inline error; the other fields are still saved", async ({ loginAs }) => {
  const m = await createMember({ name: uniqueName("Inline") });
  const p = await loginAs(m);
  await p.goto("/en/my/profile");
  // Past the browser's own checks (required / maxlength), as a forged or script-less submit would be.
  await p.locator("#n").evaluate((el: HTMLInputElement) => { el.removeAttribute("required"); el.value = "   "; });
  await p.locator("#j").evaluate((el: HTMLInputElement) => { el.removeAttribute("maxlength"); el.value = "x".repeat(101); });
  await p.locator("#pf-prov").evaluate((el: HTMLSelectElement) => { const o = document.createElement("option"); o.value = "ON"; el.append(o); el.value = "ON"; }); // a Canadian province for the US
  await p.locator("#o").fill("E2E Saved Anyway");
  await p.getByRole("button", { name: t("profile.save") }).click();
  await expect(p).toHaveURL(/long=jobTitle/);
  const summary = p.locator("main").getByRole("alert");
  await expect(summary).toContainText(t("profile.tooLongTitle"));
  for (const label of [t("auth.name"), t("profile.jobTitle"), t("join.state")]) await expect(summary.getByRole("link", { name: label })).toBeVisible();
  await expect(p.locator("#n")).toHaveAttribute("aria-describedby", "n-err");
  await expect(p.locator("#n-err")).toHaveText(t("profile.errNameBlank"));
  await expect(p.locator("#j-err")).toHaveText(t("profile.errTooLong", { max: 100 }));
  await expect(p.locator("#pf-prov-err")).toHaveText(t("profile.errProvince"));
  expect(await userById(m.id)).toMatchObject({ name: m.name, jobTitle: null, country: "United States", province: "NY", organisation: "E2E Saved Anyway" });
});

test("the profile's read-only membership summary matches My membership, for every status", async ({ loginAs }) => {
  const summary = (p: import("@playwright/test").Page) => p.getByRole("region", { name: t("profile.membershipTitle"), exact: true });
  // Active member: tier, status and dates; a link to My membership; nothing editable.
  const m = await createMember();
  let p = await loginAs(m);
  await p.goto("/en/my/profile");
  await expect(summary(p)).toContainText("Professional");
  await expect(summary(p)).toContainText(t("member.billingPage.st_active"));
  await expect(summary(p)).toContainText(t("member.billingPage.since"));
  await expect(summary(p)).toContainText(t("member.billingPage.renews"));
  await expect(summary(p).locator("input, select, textarea, button")).toHaveCount(0);
  await summary(p).getByRole("link", { name: t("profile.membershipLink") }).click();
  await expect(p).toHaveURL(/\/en\/my\/billing$/);

  // Lapsed (renewal date over 30 days ago → lapses on the next visit): "Started" / "Renewal was due", never "Member since".
  const l = await createUser({ name: uniqueName("Lapsed") });
  await createMembership(l.id, { renewsAt: new Date(Date.now() - 40 * 864e5) });
  p = await loginAs(l);
  await p.goto("/en/my/billing");
  await expect(membershipStatus(p, "st_lapsed")).toBeVisible();
  await expect(membershipCard(p)).toContainText(t("member.billingPage.started"));
  await expect(membershipCard(p)).toContainText(t("member.billingPage.renewalWasDue"));
  await expect(membershipCard(p)).not.toContainText(t("member.billingPage.since"));
  await p.goto("/en/my/profile");
  await expect(summary(p)).toContainText(t("member.billingPage.st_lapsed"));
  await expect(summary(p)).toContainText(t("member.billingPage.renewalWasDue"));

  // Guest without a membership: "No membership" + Apply.
  const g = await createUser();
  p = await loginAs(g);
  await p.goto("/en/my/profile");
  await expect(summary(p)).toContainText(t("member.billingPage.st_none"));
  await expect(summary(p).getByRole("link", { name: t("member.billingPage.apply") })).toHaveAttribute("href", "/en/join");
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
  // Internal fields are left out (staff user ids, the Admin Portal role, the one-open-membership slot); the facts stay.
  expect(data).not.toHaveProperty("adminRoleId");
  expect(data.memberships[0]).not.toHaveProperty("verifiedBy");
  expect(data.memberships[0]).not.toHaveProperty("activeSlot");
  expect(data.memberships[0]).toMatchObject({ status: "active" });
  for (const c of data.cpe) expect(c).not.toHaveProperty("createdBy");

  const csv = await p.request.get("/api/me/export?format=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["cache-control"]).toContain("no-store");
  const body = await csv.text();
  expect(body.split("\n")[0]).toBe('"section","field","value"');
  expect(body).toContain(`"profile","email","${m.email}"`);
  expect(body).toContain('"membership_1","status","active"');
  expect(body).not.toMatch(/passwordHash|sessionVersion|adminRoleId|verifiedBy|activeSlot|createdBy|\$2[aby]\$/);

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
  await p.goto("/en/my/billing");
  await expect(p).toHaveURL(/\/en\/login/);
  // The old credentials no longer work.
  await page.goto("/en/login");
  await page.locator("#le").fill(m.email); await page.locator("#lp").fill(m.password);
  await page.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(page, t("auth.invalid"), { email: m.email });
});

test("delete-account password attempts are throttled on their own counter; sign-in is not affected (S6)", async ({ loginAs }) => {
  const m = await createMember();
  const p = await loginAs(m);
  const attempt = async (pw: string) => {
    await p.goto("/en/my/profile");
    const del = p.locator("form.mbr-danger");
    await del.locator("#dp").fill(pw);
    await del.locator("input[name=confirm]").check();
    await del.getByRole("button", { name: t("profile.deleteBtn") }).click();
  };
  try {
    for (let i = 1; i <= 5; i++) { // same threshold as sign-in (5 failures, then a lock)
      await attempt(`Wrong-password-${i}`);
      await expect(p, `attempt ${i}`).toHaveURL(/del=wrong/);
    }
    await attempt(m.password); // locked: even the right password is not checked
    await expect(p).toHaveURL(/del=locked/);
    await expect(p.locator("main").getByRole("alert")).toHaveText(t("profile.deleteLocked"));
    expect((await userById(m.id))!.role).toBe("member");
    expect(await count(`SELECT count(*) AS n FROM "LoginThrottle" WHERE key = $1 AND "lockedUntil" > now()`, [`del:${m.id}`])).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM "LoginThrottle" WHERE key = $1`, [`e:${m.email}`]), "the sign-in counter is untouched").toBe(0);
    // Signing in still works (a separate counter).
    await loginAs(m);
  } finally {
    await q(`DELETE FROM "LoginThrottle" WHERE key = $1`, [`del:${m.id}`]);
  }
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
    await expect(cards.getByText(t("member.directoryPage.you"), { exact: true })).toBeVisible();
    await expect(p.getByRole("note")).toContainText(t("member.directoryPage.youListed"));
  });

  test("Admin Portal accounts and deactivated accounts are never listed; admins get the members-only notice (S4)", async ({ loginAs }) => {
    const tok = uniqueName("DirSep");
    const viewer = await createAdminRole({ permissions: { members: ["view"] } });
    const admin = await createUser({ role: "admin", adminRoleId: viewer.id, name: `${tok} Admin`, directoryOptIn: true });
    await createMembership(admin.id); // an admin with an active membership, opted in: still not a listed member
    const inactive = await createMember({ name: `${tok} Inactive`, directoryOptIn: true, active: false });
    const listed = await createMember({ name: `${tok} Listed`, directoryOptIn: true });
    const me = await createMember();
    const p = await loginAs(me);
    await p.goto(`/en/my/directory?q=${encodeURIComponent(tok)}`);
    const cards = p.locator(".mbr-people .member-card");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(listed.name);
    await expect(p.locator("main")).not.toContainText(admin.name);
    await expect(p.locator("main")).not.toContainText(inactive.name);

    // The admin (any role, even with an active membership) can't browse it: the guest's members-only notice, no join button.
    const ap = await loginAs(admin, { expectUrl: /\/en\/admin\/members$/ });
    await ap.goto("/en/my/directory");
    await expect(ap.getByRole("heading", { name: t("member.directoryPage.membersOnly") })).toBeVisible();
    await expect(ap.locator(".mbr-people")).toHaveCount(0);
    await expect(ap.locator("main")).not.toContainText(listed.name);
    await ap.goto("/en/my/community");
    await expect(ap.locator('main a[href="/en/my/directory"]')).toHaveCount(0);
  });

  test("is only browsable by active members", async ({ loginAs }) => {
    const g = await createUser();
    const p = await loginAs(g);
    await p.goto("/en/my/directory");
    await expect(p.getByRole("heading", { name: t("member.directoryPage.membersOnly") })).toBeVisible();
    await expect(p.locator(".mbr-people")).toHaveCount(0);
  });
});
