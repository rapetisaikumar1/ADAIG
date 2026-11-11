"use server";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { assertAdminPermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { cleanText, emailOk, normEmail, isUniqueViolation } from "@/lib/validation";
import { tiers as defaultTiers } from "@/config/site";
import {
  SETTINGS_TAG, SITE_KEY, OPS_KEY, tierKey, resolveTiers, tierOverrideSchema, opsSchema,
  REJECTED_POLICIES, PAID_TICKET_POLICIES, MEMBERSHIP_REFUND_POLICIES, type TierOverride, type OpsOverrides,
} from "@/lib/settings";

/** Input limits for the settings forms (characters / lines). */
const MAX = { tierName: 60, tierDescription: 300, benefit: 200, benefits: 12, order: 99, address: 300, addressLines: 6, ttlHours: 8760 };

type Section = "tiers" | "site" | "ops";
/** Back to the settings page with a notice; `anchor` scrolls to the edited block, where the notice is shown. */
function back(locale: string, msg: string, anchor: string): never {
  redirect(`/${locale}/admin/settings?msg=${msg}&s=${encodeURIComponent(anchor)}#${anchor}`);
}
const anchorFor = (key: string) => key.replace(/\./g, "-"); // "tier.student" → "tier-student"

/**
 * Write (or delete, when `value` is null) one Setting row, only if nobody changed it since the form was loaded
 * (`v` = the row's updatedAt as ISO, or "none" when there was no row). Returns false on a concurrent change.
 */
async function writeSetting(key: string, value: Prisma.InputJsonValue | null, v: string, actor: string): Promise<boolean> {
  const cur = await db.setting.findUnique({ where: { key } });
  if ((cur ? cur.updatedAt.toISOString() : "none") !== v) return false;
  if (value === null) {
    if (cur) return (await db.setting.deleteMany({ where: { key, updatedAt: cur.updatedAt } })).count === 1;
    return true;
  }
  if (cur) return (await db.setting.updateMany({ where: { key, updatedAt: cur.updatedAt }, data: { value, updatedBy: actor, updatedAt: new Date() } })).count === 1;
  try { await db.setting.create({ data: { key, value, updatedBy: actor } }); return true; }
  catch (e) { if (isUniqueViolation(e)) return false; throw e; }
}
async function done(actor: string, action: string, target: string) {
  await db.auditLog.create({ data: { actor, action, target } });
  updateTag(SETTINGS_TAG); // pages read the new values on their next request (no redeploy)
}
/** Every settings action: Settings are the "system" module; saving or resetting needs system.edit (§3.2). */
async function admin(fd: FormData) {
  const { locale, ctx } = await assertAdminPermission(fd, "system", "edit");
  return { locale, a: ctx.user };
}

/** Lines of a textarea: control characters stripped, whitespace collapsed, blank lines dropped. null if any line is too long. */
function lines(v: FormDataEntryValue | null, max: number): string[] | null {
  const out: string[] = [];
  for (const raw of String(v ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.replace(/[\u0000-\u001f\u007f]/g, "").trim()) continue;
    const s = cleanText(raw, max); if (!s) return null;
    out.push(s);
  }
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Save one membership tier's texts and flags (EN + FR). Values equal to the code defaults remove the override row. */
export async function saveTier(fd: FormData) {
  const { locale, a } = await admin(fd);
  const id = String(fd.get("id") ?? ""); const idx = defaultTiers.findIndex((t) => t.id === id);
  if (idx < 0) back(locale, "invalid", "tiers");
  const key = tierKey(id), anchor = anchorFor(key);
  const txt = (name: string, max: number) => cleanText(fd.get(name), max);
  const name = { en: txt("nameEn", MAX.tierName), fr: txt("nameFr", MAX.tierName) };
  const description = { en: txt("descEn", MAX.tierDescription), fr: txt("descFr", MAX.tierDescription) };
  const bEn = lines(fd.get("benefitsEn"), MAX.benefit), bFr = lines(fd.get("benefitsFr"), MAX.benefit);
  const order = Number(fd.get("order"));
  if (!name.en || !name.fr || !description.en || !description.fr || !bEn || !bFr || !bEn.length || bEn.length > MAX.benefits
    || !Number.isInteger(order) || order < 1 || order > MAX.order) back(locale, "invalid", anchor);
  if (bEn.length !== bFr.length) back(locale, "benefitsMismatch", anchor);
  const parsed = tierOverrideSchema.safeParse({
    name, description, benefits: bEn.map((en, i) => ({ en, fr: bFr[i] })), order,
    featured: fd.get("featured") === "on", requiresVerification: fd.get("requiresVerification") === "on", visible: fd.get("visible") === "on",
  });
  if (!parsed.success) back(locale, "invalid", anchor);
  const value: TierOverride = parsed.data;
  // At least one tier must stay offered on /membership and /join.
  const others = new Map((await db.setting.findMany({ where: { key: { startsWith: "tier." } } })).map((r) => [r.key, r.value as unknown]));
  others.set(key, value);
  if (!resolveTiers(others).some((t) => t.visible)) back(locale, "lastVisible", anchor);
  const d = defaultTiers[idx];
  const isDefault = same(value, { name: d.name, description: d.description, benefits: d.benefits, featured: !!d.featured, requiresVerification: !!d.requiresVerification, order: idx + 1, visible: true });
  const before = await db.setting.findUnique({ where: { key } });
  if (!(await writeSetting(key, isDefault ? null : value, String(fd.get("v") ?? ""), a.id))) back(locale, "conflict", anchor);
  if (!same(before?.value ?? null, isDefault ? null : value)) await done(a.id, isDefault ? "settings.tier_reset" : "settings.tier_updated", key);
  back(locale, "saved", anchor);
}

/** Reset one tier to the code defaults (delete its override). */
export async function resetTier(fd: FormData) {
  const { locale, a } = await admin(fd);
  const id = String(fd.get("id") ?? ""); if (!defaultTiers.some((t) => t.id === id)) back(locale, "invalid", "tiers");
  const key = tierKey(id);
  const others = new Map((await db.setting.findMany({ where: { key: { startsWith: "tier." } } })).map((r) => [r.key, r.value as unknown]));
  others.delete(key);
  if (!resolveTiers(others).some((t) => t.visible)) back(locale, "lastVisible", anchorFor(key)); // defaults are visible, so this can't trigger; kept for safety
  if ((await db.setting.deleteMany({ where: { key } })).count) await done(a.id, "settings.tier_reset", key);
  back(locale, "reset", anchorFor(key));
}

/** Reset every tier to the code defaults. */
export async function resetAllTiers(fd: FormData) {
  const { locale, a } = await admin(fd);
  const r = await db.setting.deleteMany({ where: { key: { in: defaultTiers.map((t) => tierKey(t.id)) } } });
  if (r.count) await done(a.id, "settings.tiers_reset_all", "tiers");
  back(locale, "reset", "tiers");
}

/** Public contact email + postal address (both optional; empty = not shown anywhere). */
export async function saveSite(fd: FormData) {
  const { locale, a } = await admin(fd);
  const rawEmail = String(fd.get("contactEmail") ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  const contactEmail = normEmail(rawEmail);
  if (contactEmail && !emailOk(contactEmail)) back(locale, "invalidEmail", "site");
  const addr = lines(fd.get("postalAddress"), MAX.address);
  if (!addr || addr.length > MAX.addressLines || addr.join("\n").length > MAX.address) back(locale, "invalid", "site");
  const value = { contactEmail, postalAddress: addr.join("\n") };
  const empty = !value.contactEmail && !value.postalAddress;
  const before = await db.setting.findUnique({ where: { key: SITE_KEY } });
  if (!(await writeSetting(SITE_KEY, empty ? null : value, String(fd.get("v") ?? ""), a.id))) back(locale, "conflict", "site");
  if (!same(before?.value ?? null, empty ? null : value)) await done(a.id, empty ? "settings.contact_reset" : "settings.contact_updated", SITE_KEY);
  back(locale, "saved", "site");
}

/** Operational policies. Each field may be "default" (blank) = env/code default. */
export async function saveOps(fd: FormData) {
  const { locale, a } = await admin(fd);
  const pick = <T extends string>(name: string, allowed: readonly T[]): T | undefined | null => {
    const v = String(fd.get(name) ?? ""); if (!v) return undefined;
    return (allowed as readonly string[]).includes(v) ? (v as T) : null;
  };
  const dir = pick("directoryOptInDefault", ["on", "off"] as const);
  const rej = pick("rejectedStudentPolicy", REJECTED_POLICIES), tick = pick("deletedUserPaidTickets", PAID_TICKET_POLICIES), refund = pick("deletedMembershipRefund", MEMBERSHIP_REFUND_POLICIES);
  const ttlRaw = String(fd.get("unpaidOrderTtlHours") ?? "").trim(); const ttl = ttlRaw ? Number(ttlRaw) : undefined;
  if (dir === null || rej === null || tick === null || refund === null || (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX.ttlHours))) back(locale, "invalid", "ops");
  const raw: OpsOverrides = {
    ...(dir ? { directoryOptInDefault: dir === "on" } : {}), ...(ttl !== undefined ? { unpaidOrderTtlHours: ttl } : {}),
    ...(rej ? { rejectedStudentPolicy: rej } : {}), ...(tick ? { deletedUserPaidTickets: tick } : {}), ...(refund ? { deletedMembershipRefund: refund } : {}),
  };
  const parsed = opsSchema.safeParse(raw); if (!parsed.success) back(locale, "invalid", "ops");
  const empty = Object.keys(parsed.data).length === 0;
  const before = await db.setting.findUnique({ where: { key: OPS_KEY } });
  if (!(await writeSetting(OPS_KEY, empty ? null : parsed.data, String(fd.get("v") ?? ""), a.id))) back(locale, "conflict", "ops");
  if (!same(before?.value ?? null, empty ? null : parsed.data)) await done(a.id, empty ? "settings.ops_reset" : "settings.ops_updated", OPS_KEY);
  back(locale, "saved", "ops");
}

/** Reset the site/contact or operational block to defaults (delete the row). */
async function resetSection(fd: FormData, section: Exclude<Section, "tiers">) {
  const { locale, a } = await admin(fd);
  const key = section === "site" ? SITE_KEY : OPS_KEY;
  if ((await db.setting.deleteMany({ where: { key } })).count) await done(a.id, section === "site" ? "settings.contact_reset" : "settings.ops_reset", key);
  back(locale, "reset", section);
}
export async function resetSite(fd: FormData) { await resetSection(fd, "site"); }
export async function resetOps(fd: FormData) { await resetSection(fd, "ops"); }
