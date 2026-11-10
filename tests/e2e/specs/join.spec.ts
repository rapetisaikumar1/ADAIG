/** Membership application (new account) → dashboard "application received" → admin approve / reject → member status. */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { auditRows, membershipsOf, userByEmail, uniqueEmail, uniquePassword, RUN } from "../support/db";
import { t } from "../support/i18n";

type Applicant = { first: string; last: string; email: string; password: string; org: string };
const applicant = (): Applicant => ({ first: "E2E", last: `Applicant ${RUN}${Math.random().toString(36).slice(2, 6)}`, email: uniqueEmail(), password: uniquePassword(), org: "E2E Applicants Inc" });

async function fillApplication(page: Page, a: Applicant, opts: { tier?: string; institution?: string } = {}) {
  await page.goto(`/en/join${opts.tier ? `?tier=${opts.tier}` : ""}`);
  if (opts.tier) await expect(page.locator("#tier")).toHaveValue(opts.tier);
  await page.locator("#fn").fill(a.first);
  await page.locator("#ln").fill(a.last);
  await page.locator("#org").fill(a.org);
  await expect(page.locator("#co")).toHaveValue("United States");
  await page.locator("#pr").selectOption("NY");
  if (opts.institution) {
    await page.locator("#inst").fill(opts.institution);
    await page.locator("input[name=eligibilityAttest]").check();
  }
  await page.locator("#em").fill(a.email);
  await page.locator("#pw").fill(a.password);
}

test("new applicant → application received → admin approves → active member @smoke", async ({ page, adminPage }) => {
  const a = applicant(); const name = `${a.first} ${a.last}`;
  await fillApplication(page, a, { tier: "professional" });
  await page.getByRole("button", { name: t("join.submit") }).click();
  await expect(page).toHaveURL(/\/en\/my\/dashboard\?applied=1/);
  await expect(page.locator(".mbr-alerts .alert-success")).toContainText(t("dash.appliedTitle"));
  await expect(page.locator(".mbr-kpis")).toContainText(t("dash.underReview"));

  const u = await userByEmail(a.email);
  expect(u).toMatchObject({ role: "guest", name, organisation: a.org, province: "NY" });
  const [m] = await membershipsOf(u!.id);
  expect(m).toMatchObject({ tierId: "professional", status: "pending_verification", activeSlot: u!.id });
  expect(await auditRows({ action: "membership.application_submitted", target: m.id })).toHaveLength(1);

  // Admin: the application is in the "pending" queue; approve it.
  await adminPage.goto(`/en/admin/members?f=pending&q=${encodeURIComponent(a.email)}`);
  const row = adminPage.locator("tbody tr", { hasText: a.email });
  await expect(row).toHaveClass(/is-pending/);
  await row.getByRole("button", { name: `${t("admin.approve")}: ${name}` }).click();
  await expect(adminPage).toHaveURL(/msg=approved/);
  await expect(adminPage.locator("main").getByRole("status")).toContainText(t("admin.approved"));

  const [after] = await membershipsOf(u!.id);
  expect(after.status).toBe("active");
  expect(after.renewsAt && +after.renewsAt - Date.now()).toBeGreaterThan(360 * 864e5);
  expect((await userByEmail(a.email))!.role).toBe("member");

  // Applicant: dashboard shows the active membership; applying again is refused.
  await page.goto("/en/my/dashboard");
  await expect(page.locator(".mbr-kpis")).toContainText("Professional");
  await expect(page.locator(".mbr-kpis")).toContainText(t("dash.active"));
  await page.goto("/en/join");
  await expect(page).toHaveURL(/\/en\/my\/dashboard\?already=1/);
  await expect(page.locator(".mbr-alerts")).toContainText(t("dash.alreadyMember"));
});

test("student application needs eligibility details; a rejection reason is shown to the applicant", async ({ page, adminPage }) => {
  const a = applicant(); const reason = `E2E reason ${RUN}`;
  await page.goto("/en/join");
  await expect(page.locator("#inst")).toHaveCount(0);
  await page.locator("#tier").selectOption("student");
  await expect(page.locator("#inst")).toBeVisible();
  await fillApplication(page, a, { tier: "student", institution: "E2E University" });
  await page.getByRole("button", { name: t("join.submit") }).click();
  await expect(page).toHaveURL(/applied=1/);
  const u = await userByEmail(a.email);
  const [m] = await membershipsOf(u!.id);
  expect(m.status).toBe("pending_verification");

  await adminPage.goto(`/en/admin/members/${u!.id}`);
  await expect(adminPage.locator("#memberships")).toContainText("Attested student at: E2E University");
  await adminPage.locator("#memberships summary", { hasText: t("admin.reject") }).click();
  await adminPage.locator(`#rr-${m.id}`).fill(reason);
  await adminPage.getByRole("button", { name: t("admin.confirmReject") }).click();
  await expect(adminPage).toHaveURL(/msg=msg_rejected/);
  const [after] = await membershipsOf(u!.id);
  expect(after).toMatchObject({ status: "rejected_verification", rejectionReason: reason, activeSlot: null });
  expect(await auditRows({ action: "membership.eligibility_rejected", target: m.id })).toHaveLength(1);

  await page.goto("/en/my/dashboard");
  await expect(page.locator("main").getByRole("alert")).toContainText(t("dash.rejectedTitle"));
  await expect(page.locator("main").getByRole("alert")).toContainText(reason);
});

test("an existing email gets a generic error and the form keeps what was typed", async ({ page }) => {
  const a = { ...applicant(), email: "member@adaig.test" };
  await fillApplication(page, a);
  await page.getByRole("button", { name: t("join.submit") }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(t("join.err_generic_account"));
  await expect(page.locator("#fn")).toHaveValue(a.first);
  await expect(page.locator("#org")).toHaveValue(a.org);
  await expect(page).toHaveURL(/\/en\/join/);
});
