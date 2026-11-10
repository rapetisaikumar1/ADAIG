/**
 * Admin → Members: account page (profile, tier, renewal, lapse/reactivate, grant, CPE ledger, temporary password +
 * session invalidation, delete), new account, role changes, last-admin protections, members CSV.
 */
import type { Page } from "@playwright/test";
import { test, expect, uiLogin, expectLoginRefused } from "../fixtures";
import { auditRows, createMember, createUser, etDay, membershipsOf, one, q, userByEmail, userById, uniqueEmail, uniqueName, uniquePassword, RUN } from "../support/db";
import { SEED } from "../support/env";
import { t } from "../support/i18n";

const tm = (k: string, v?: Record<string, string | number>) => t(`adminMembers.${k}`, v);
const account = (p: Page, id: string) => p.goto(`/en/admin/members/${id}`);
const notice = (p: Page) => p.locator("main .alert").first();
const openDetails = (p: Page, scope: string, summary: string) => p.locator(`${scope} summary`, { hasText: summary }).click();

test("account page: edit the profile (email, country, state, flags)", async ({ adminPage: p }) => {
  const u = await createUser();
  const newEmail = uniqueEmail(); const name = uniqueName("Edited");
  await account(p, u.id);
  await expect(p.locator("h1")).toHaveText(u.name);
  await p.locator("#p-name").fill(name);
  await p.locator("#p-email").fill(newEmail.toUpperCase());
  await p.locator("#p-org").fill("E2E Edited Org");
  await p.locator("#p-job").fill("E2E Chief Records Officer");
  await p.locator("#p-country").selectOption("Canada");
  await p.locator("#p-prov").selectOption("ON");
  await p.locator("#p-lang").selectOption("fr");
  await p.locator("#profile input[name=directoryOptIn]").check();
  await p.getByRole("button", { name: tm("saveProfile") }).click();
  await expect(p).toHaveURL(/msg=msg_profileSaved/);
  await expect(notice(p)).toHaveText(tm("msg_profileSaved"));
  expect(await userById(u.id)).toMatchObject({ name, email: newEmail, organisation: "E2E Edited Org", jobTitle: "E2E Chief Records Officer", country: "Canada", province: "ON", locale: "fr", directoryOptIn: true });
  expect(await auditRows({ action: "admin.email_changed", target: u.id })).toHaveLength(1);
  // A state that does not belong to the country is refused (the form only offers matching ones; forge the pair).
  await p.locator("#p-country").selectOption("United Kingdom");
  await expect(p.locator("#p-prov")).toBeDisabled();
  await p.locator("#p-prov").evaluate((el) => { const s = el as HTMLSelectElement; s.disabled = false; s.innerHTML = '<option value="ON" selected>ON</option>'; });
  await p.getByRole("button", { name: tm("saveProfile") }).click();
  await expect(p).toHaveURL(/msg=err_province/);
  expect((await userById(u.id))!.country).toBe("Canada");
});

test("memberships: change tier, renewal date, lapse and reactivate", async ({ adminPage: p }) => {
  const m = await createMember();
  await account(p, m.id);
  // Change tier.
  await openDetails(p, "#memberships", tm("changeTier"));
  await p.locator(`#ti-${m.membershipId}`).selectOption("public-sector");
  await p.locator("#memberships details[open]").getByRole("button", { name: tm("saveTier") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  expect((await membershipsOf(m.id))[0].tierId).toBe("public-sector");
  await expect(p.locator("#memberships")).toContainText("Public sector / NFP");

  // Renewal date (entered as an ET day, stored as noon ET).
  const day = etDay(new Date(Date.now() + 200 * 864e5));
  await account(p, m.id);
  await openDetails(p, "#memberships", tm("renewal"));
  await p.locator(`#rn-${m.membershipId}`).fill(day);
  await p.getByRole("button", { name: tm("saveRenewal") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  const [r] = await membershipsOf(m.id);
  expect(etDay(r.renewsAt!)).toBe(day);
  expect(await auditRows({ action: "membership.renewal_changed", target: m.membershipId })).toHaveLength(1);

  // Lapse → role back to guest; reactivate → active member again.
  await account(p, m.id);
  await openDetails(p, "#memberships", tm("markLapsed"));
  await p.locator("#memberships details[open] input[name=confirm]").check();
  await p.getByRole("button", { name: tm("markLapsedYes") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  expect((await membershipsOf(m.id))[0]).toMatchObject({ status: "lapsed", activeSlot: null });
  expect((await userById(m.id))!.role).toBe("guest");

  await account(p, m.id);
  await openDetails(p, "#memberships", tm("reactivate"));
  await p.getByRole("button", { name: tm("reactivateYes") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipSaved/);
  expect((await membershipsOf(m.id))[0]).toMatchObject({ status: "active", activeSlot: m.id });
  expect((await userById(m.id))!.role).toBe("member");
});

test("grant a membership to an account without one", async ({ adminPage: p }) => {
  const u = await createUser();
  await account(p, u.id);
  await p.locator("#g-tier").selectOption("retired");
  await p.getByRole("button", { name: tm("grantButton") }).click();
  await expect(p).toHaveURL(/msg=msg_membershipAdded/);
  const [m] = await membershipsOf(u.id);
  expect(m).toMatchObject({ tierId: "retired", status: "active" });
  expect((await userById(u.id))!.role).toBe("member");
  await expect(p.locator("#g-tier")).toHaveCount(0); // an open membership hides the grant form
});

test("CPE ledger: add and remove an entry", async ({ adminPage: p }) => {
  const m = await createMember();
  const title = `E2E CPE ${RUN} ${Math.random().toString(36).slice(2, 6)}`;
  await account(p, m.id);
  await p.locator("#c-title").fill(title);
  await p.locator("#c-hours").fill("2.5");
  await p.locator("#c-status").selectOption("approved");
  await p.getByRole("button", { name: tm("cpeAdd") }).click();
  await expect(p).toHaveURL(/msg=msg_cpeAdded/);
  const row = p.locator("#cpe tbody tr", { hasText: title });
  await expect(row).toContainText("2.5");
  await expect(p.locator("#cpe .adm-card-head")).toContainText("2.5");
  const entry = await one<{ id: string; hours: number; status: string; createdBy: string }>(`SELECT * FROM "CpeEntry" WHERE "userId" = $1 AND title = $2`, [m.id, title]);
  expect(entry).toMatchObject({ hours: 2.5, status: "approved" });
  expect(entry!.createdBy).toBeTruthy();

  await p.locator(`#cpe summary[aria-label="${tm("cpeRemove")}: ${title}"]`).click();
  await p.locator("#cpe details[open]").getByRole("button", { name: tm("cpeRemoveYes") }).click();
  await expect(p).toHaveURL(/msg=msg_cpeRemoved/);
  await expect(p.locator("#cpe tbody tr", { hasText: title })).toHaveCount(0);
  expect(await one(`SELECT id FROM "CpeEntry" WHERE id = $1`, [entry!.id])).toBeUndefined();
});

test("temporary password: the old session is signed out and only the new password works", async ({ adminPage: p, loginAs, newPage }) => {
  const u = await createMember();
  const session = await loginAs(u);
  const newPassword = uniquePassword();
  await account(p, u.id);
  await p.locator("#pw-new").fill(newPassword);
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(p.locator(".adm-mbr-pw .alert-success")).toContainText(tm("pwSet"));
  await expect(p.locator(".adm-mbr-secret")).toHaveText(newPassword);
  expect(p.url()).not.toContain(newPassword);
  expect((await userById(u.id))!.sessionVersion).toBe(1);
  const audit = await auditRows({ action: "admin.password_reset", target: u.id });
  expect(audit).toHaveLength(1);

  // The member's existing session no longer works.
  await session.goto("/en/my/dashboard");
  await expect(session).toHaveURL(/\/en\/login/);
  // Old password refused, new password accepted.
  const fresh = await newPage();
  await fresh.goto("/en/login");
  await fresh.locator("#le").fill(u.email); await fresh.locator("#lp").fill(u.password);
  await fresh.locator("main form").getByRole("button", { name: t("auth.signIn") }).click();
  await expectLoginRefused(fresh, t("auth.invalid"), { email: u.email });
  await uiLogin(fresh, { email: u.email, password: newPassword });
  await expect(fresh.locator("h1")).toHaveText(u.name);
});

test("generated temporary password and weak typed passwords", async ({ adminPage: p }) => {
  const u = await createUser();
  await account(p, u.id);
  await p.locator("#pw-new").fill("password123!");
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(p.locator(".adm-mbr-pw .alert-danger")).toHaveText(tm("err_pw_common"));
  expect((await userById(u.id))!.sessionVersion).toBe(0);
  await p.locator("#pw-new").fill("");
  await p.getByRole("button", { name: tm("pwButton") }).click();
  await expect(p.locator(".adm-mbr-secret")).toHaveText(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
});

test("new account with a generated password and a membership", async ({ adminPage: p, newPage }) => {
  const email = uniqueEmail(); const name = uniqueName("Created");
  await p.goto("/en/admin/members/new");
  await p.locator("#n-name").fill(name);
  await p.locator("#n-email").fill(email);
  await p.locator("#n-org").fill("E2E Offline Org");
  await p.locator("#n-prov").selectOption("NY");
  await expect(p.locator("#n-role option[value=member]")).toHaveCount(0); // member comes from the membership below
  await p.locator("#n-tier").selectOption("professional");
  await p.locator("main form").getByRole("button", { name: tm("createButton") }).click();
  await expect(p.locator("main .alert-success")).toContainText(tm("createdTitle", { name }));
  const password = (await p.locator(".adm-mbr-secret").textContent())!.trim();
  expect(password.length).toBeGreaterThanOrEqual(12);
  const u = await userByEmail(email);
  expect(u).toMatchObject({ name, role: "member", organisation: "E2E Offline Org", province: "NY" });
  expect((await membershipsOf(u!.id))[0]).toMatchObject({ status: "active", tierId: "professional" });
  expect(await auditRows({ action: "admin.account_created", target: u!.id })).toHaveLength(1);
  // Duplicate email is refused.
  await p.goto("/en/admin/members/new");
  await p.locator("#n-name").fill(name); await p.locator("#n-email").fill(email);
  await p.locator("main form").getByRole("button", { name: tm("createButton") }).click();
  await expect(p.locator("main .alert-danger")).toHaveText(tm("err_emailTaken"));
  // The generated password works.
  const s = await newPage();
  await uiLogin(s, { email, password });
  await expect(s.locator(".mbr-kpis")).toContainText("Professional");
});

test("delete an account (anonymized, financial records kept)", async ({ adminPage: p }) => {
  const m = await createMember();
  await account(p, m.id);
  await p.locator("#delete input[name=confirm]").check();
  await p.getByRole("button", { name: tm("deleteButton") }).click();
  await expect(p).toHaveURL(/\/en\/admin\/members\?msg=accountDeleted/);
  await expect(notice(p)).toHaveText(tm("list_accountDeleted"));
  expect(await userById(m.id)).toMatchObject({ role: "deleted", email: `deleted-${m.id}@deleted.invalid`, name: "Deleted member" });
  expect((await membershipsOf(m.id))[0].status).toBe("cancelled");
  expect(await auditRows({ action: "account.deleted_by_admin", target: m.id })).toHaveLength(1);
  // The deleted account is no longer listed; its page shows the deleted notice only.
  await p.goto(`/en/admin/members?q=${encodeURIComponent(m.email)}`);
  await expect(p.locator("tbody tr", { hasText: m.email })).toHaveCount(0);
  await account(p, m.id);
  await expect(p.locator("main")).toContainText(tm("deletedTitle"));
  await expect(p.locator("#delete")).toHaveCount(0);
});

test("make admin and remove admin from the members list", async ({ adminPage: p }) => {
  const u = await createUser();
  await p.goto(`/en/admin/members?q=${encodeURIComponent(u.email)}`);
  await p.locator(`summary[aria-label="${t("admin.makeAdmin")}: ${u.name}"]`).click(); // confirm step
  await p.locator("details[open]").getByRole("button", { name: t("admin.makeAdminYes") }).click();
  await expect(p).toHaveURL(/msg=roleChanged/);
  expect((await userById(u.id))!.role).toBe("admin");
  await p.goto(`/en/admin/members?q=${encodeURIComponent(u.email)}`);
  await p.locator(`summary[aria-label="${t("admin.removeAdmin")}: ${u.name}"]`).click();
  await p.locator("details[open]").getByRole("button", { name: t("admin.removeAdminYes") }).click();
  await expect(p).toHaveURL(/msg=roleChanged/);
  expect((await userById(u.id))!.role).toBe("guest");
  expect(await auditRows({ action: "admin.role_promoted", target: u.id })).toHaveLength(1);
  expect(await auditRows({ action: "admin.role_demoted", target: u.id })).toHaveLength(1);
});

test.describe("last-admin and self protections", () => {
  test("an admin cannot change their own role or delete their own account (UI and forged forms)", async ({ adminPage: p }) => {
    const me = (await userByEmail(SEED.admin))!;
    await account(p, me.id);
    await expect(p.locator("#account")).toContainText(tm("selfRole"));
    await expect(p.locator("#role")).toHaveCount(0);
    await expect(p.locator("#delete")).toContainText(tm("deleteSelf"));
    await expect(p.locator("#delete button")).toHaveCount(0);
    await p.goto(`/en/admin/members?q=${encodeURIComponent(SEED.admin)}`);
    await expect(p.locator("tbody tr", { hasText: SEED.admin })).toContainText(t("admin.you"));

    // Forged: another account's forms re-pointed at my own id are refused server-side.
    const other = await createUser();
    await account(p, other.id);
    await p.locator("#account summary", { hasText: t("admin.makeAdmin") }).click();
    const roleForm = p.locator("#account details[open] form");
    await roleForm.evaluate((f, id) => { (f.querySelector("input[name=uid]") as HTMLInputElement).value = id; }, me.id);
    await roleForm.getByRole("button", { name: t("admin.makeAdminYes") }).click();
    await expect(p).toHaveURL(new RegExp(`/admin/members/${me.id}\\?msg=err_selfRole`));
    await expect(notice(p)).toHaveText(tm("err_selfRole"));
    await account(p, other.id);
    await p.locator("#delete").evaluate((f, id) => { (f.querySelector("input[name=uid]") as HTMLInputElement).value = id; }, me.id);
    await p.locator("#delete input[name=confirm]").check();
    await p.getByRole("button", { name: tm("deleteButton") }).click();
    await expect(p).toHaveURL(/msg=err_selfDelete/);
    expect((await userById(me.id))!.role).toBe("admin");
    expect((await userById(other.id))!.role).toBe("guest");
  });

  test("the last admin cannot be demoted", async ({ adminPage: p }) => {
    const me = (await userByEmail(SEED.admin))!;
    // Make the seed admin the only admin for this test: every other admin is demoted, then restored in finally
    // (the teardown also restores seed rows).
    const others = await q<{ id: string; role: string }>(`SELECT id, role FROM "User" WHERE role = 'admin' AND id <> $1`, [me.id]);
    await q(`UPDATE "User" SET role = 'member' WHERE id = ANY($1)`, [others.map((o) => o.id)]);
    try {
      await account(p, me.id);
      await expect(p.locator("#account")).toContainText(tm("lastAdminNote"));
      // Forge a demotion of myself through another row's role form on the list.
      await p.goto(`/en/admin/members?q=${encodeURIComponent(SEED.admin2)}`);
      await p.locator("tbody tr", { hasText: SEED.admin2 }).locator("summary", { hasText: t("admin.makeAdmin") }).click();
      const form = p.locator("tbody tr", { hasText: SEED.admin2 }).locator("form", { has: p.locator("input[name=role]") });
      await form.evaluate((f, id) => {
        (f.querySelector("input[name=id]") as HTMLInputElement).value = id;
        (f.querySelector("input[name=role]") as HTMLInputElement).value = "member";
      }, me.id);
      await form.getByRole("button").click();
      await expect(p).toHaveURL(/msg=lastAdmin/);
      await expect(notice(p)).toHaveText(t("admin.lastAdmin"));
      expect((await userById(me.id))!.role).toBe("admin");
      expect(await auditRows({ action: "admin.demote_blocked_last_admin", target: me.id })).not.toHaveLength(0);
    } finally {
      await q(`UPDATE "User" SET role = 'admin' WHERE id = ANY($1)`, [others.map((o) => o.id)]);
    }
  });
});

test("members CSV: admin only, neutralizes spreadsheet formulas", async ({ adminPage: p }) => {
  const u = await createUser({ name: `=HYPERLINK("http://evil.example") E2E ${RUN}` });
  const r = await p.request.get("/api/admin/members.csv");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("text/csv");
  expect(r.headers()["cache-control"]).toContain("no-store");
  const body = await r.text();
  expect(body.split("\n")[0]).toContain('"name","email","role"');
  const line = body.split("\n").find((l) => l.includes(u.email))!;
  expect(line).toBeTruthy();
  expect(line.startsWith(`"'=HYPERLINK(`)).toBe(true);
  expect(body).not.toMatch(/passwordHash|\$2[aby]\$/);
});
