import { unstable_cache } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  tiers as defaultTiers, directoryOptInDefault as codeDirectoryOptInDefault, unpaidOrderTtlHours as envUnpaidOrderTtlHours,
  rejectedStudentPolicy as envRejectedStudentPolicy, deletionPolicy as envDeletionPolicy, type Tier, type RejectedStudentPolicy,
} from "@/config/site";

/**
 * Admin-editable configuration (Admin → Settings), stored in the `Setting` table (key → JSON value).
 * A missing row means "built-in default": tier texts from src/config/site.ts, operational policies from env (then code).
 * So with no Setting rows every page renders exactly as before. Reads go through Next's data cache (tag "settings");
 * the admin save actions call updateTag("settings"), so changes apply on the next request without a redeploy. The cache
 * also expires after SETTINGS_REVALIDATE_S, so changes made outside the admin UI (seed, SQL, a restored backup) show up too.
 * Server-only: client components receive what they need as props.
 */
export const SETTINGS_TAG = "settings";
export const tierKey = (id: string) => `tier.${id}`;
export const SITE_KEY = "site.contact";
export const OPS_KEY = "ops";

const L = z.object({ en: z.string(), fr: z.string() });
export const tierOverrideSchema = z.object({
  name: L, description: L, benefits: z.array(L).min(1),
  featured: z.boolean(), requiresVerification: z.boolean(), order: z.number().int(), visible: z.boolean(),
});
export type TierOverride = z.infer<typeof tierOverrideSchema>;
export const siteSchema = z.object({ contactEmail: z.string().default(""), postalAddress: z.string().default("") });
export type SiteInfo = z.infer<typeof siteSchema>;
export const REJECTED_POLICIES = ["notice_manual_refund", "notice_only"] as const satisfies readonly RejectedStudentPolicy[];
export const PAID_TICKET_POLICIES = ["keep", "cancel"] as const;
export const MEMBERSHIP_REFUND_POLICIES = ["none", "flag_manual_refund"] as const;
/** Each field is optional: absent = use the env/code default. */
export const opsSchema = z.object({
  directoryOptInDefault: z.boolean().optional(),
  unpaidOrderTtlHours: z.number().positive().max(8760).optional(),
  rejectedStudentPolicy: z.enum(REJECTED_POLICIES).optional(),
  deletedUserPaidTickets: z.enum(PAID_TICKET_POLICIES).optional(),
  deletedMembershipRefund: z.enum(MEMBERSHIP_REFUND_POLICIES).optional(),
});
export type OpsOverrides = z.infer<typeof opsSchema>;
export type Ops = {
  directoryOptInDefault: boolean; unpaidOrderTtlHours: number; rejectedStudentPolicy: RejectedStudentPolicy;
  deletedUserPaidTickets: (typeof PAID_TICKET_POLICIES)[number]; deletedMembershipRefund: (typeof MEMBERSHIP_REFUND_POLICIES)[number];
};

/** Safety net for the data cache: entries expire after 5 minutes even if no admin action expired them. */
const SETTINGS_REVALIDATE_S = 300;
const loadRows = () => db.setting.findMany({ select: { key: true, value: true } });
const cachedRows = unstable_cache(loadRows, ["settings:all"], { tags: [SETTINGS_TAG], revalidate: SETTINGS_REVALIDATE_S });

/**
 * All Setting rows as a map. If the cached read fails for any reason (outside a Next request, e.g. scripts, there is no
 * incremental cache) it reads the table directly; if that fails too, the built-in defaults apply.
 */
async function rows(): Promise<Map<string, unknown>> {
  let list: { key: string; value: unknown }[];
  try { list = await cachedRows(); }
  catch {
    try { list = await loadRows(); } catch (e) { console.error("[settings] read failed, using defaults", (e as Error)?.message); return new Map(); }
  }
  return new Map(list.map((r) => [r.key, r.value]));
}

export type ResolvedTier = Tier & { order: number; visible: boolean; overridden: boolean };
export const resolveTiers = (m: Map<string, unknown>): ResolvedTier[] =>
  defaultTiers
    .map((d, i) => {
      const o = tierOverrideSchema.safeParse(m.get(tierKey(d.id)));
      const base: ResolvedTier = { ...d, order: i + 1, visible: true, overridden: false };
      if (!o.success) return base;
      const { featured, requiresVerification, ...rest } = o.data;
      // keep the optional flags absent (not false) when off, exactly like the code defaults
      return { ...base, ...rest, featured: featured || undefined, requiresVerification: requiresVerification || undefined, overridden: true };
    })
    .sort((a, b) => a.order - b.order); // stable: equal order keeps the code order

/** Every tier (including hidden ones), in display order, with admin metadata. */
export async function allTiers(): Promise<ResolvedTier[]> { return resolveTiers(await rows()); }
/** Tiers offered on /membership and /join (visible only), in display order. */
export async function getTiers(): Promise<ResolvedTier[]> { return (await allTiers()).filter((t) => t.visible); }
/** Any tier by id (hidden tiers too, so existing memberships keep their name). */
export async function getTier(id: string): Promise<ResolvedTier | undefined> { return (await allTiers()).find((t) => t.id === id); }
/** One settings read, then a synchronous lookup: `const tierOf = await tierLookup(); tierOf(m.tierId)?.name[locale]`. */
export async function tierLookup(): Promise<(id: string) => ResolvedTier | undefined> {
  const list = await allTiers(); const map = new Map(list.map((t) => [t.id, t]));
  return (id: string) => map.get(id);
}

/** Built-in defaults for the operational settings (env, then code) — shown in the admin form. */
export function opsDefaults(): Ops {
  const d = envDeletionPolicy();
  return {
    directoryOptInDefault: codeDirectoryOptInDefault, unpaidOrderTtlHours: envUnpaidOrderTtlHours(), rejectedStudentPolicy: envRejectedStudentPolicy(),
    deletedUserPaidTickets: d.paidTickets === "cancel" ? "cancel" : "keep", deletedMembershipRefund: d.membershipRefund === "flag_manual_refund" ? "flag_manual_refund" : "none",
  };
}
export async function getOpsOverrides(): Promise<OpsOverrides> {
  const r = opsSchema.safeParse((await rows()).get(OPS_KEY));
  return r.success ? r.data : {};
}
/** Effective operational settings: admin value, else env, else code default. */
export async function getOps(): Promise<Ops> {
  const o = await getOpsOverrides(); const d = opsDefaults();
  return {
    directoryOptInDefault: o.directoryOptInDefault ?? d.directoryOptInDefault, unpaidOrderTtlHours: o.unpaidOrderTtlHours ?? d.unpaidOrderTtlHours,
    rejectedStudentPolicy: o.rejectedStudentPolicy ?? d.rejectedStudentPolicy,
    deletedUserPaidTickets: o.deletedUserPaidTickets ?? d.deletedUserPaidTickets, deletedMembershipRefund: o.deletedMembershipRefund ?? d.deletedMembershipRefund,
  };
}
export async function unpaidOrderTtlHours() { return (await getOps()).unpaidOrderTtlHours; }
export async function rejectedStudentPolicy() { return (await getOps()).rejectedStudentPolicy; }
export async function directoryOptInDefault() { return (await getOps()).directoryOptInDefault; }
/** Same shape as the env-based deletionPolicy() in src/config/site.ts. */
export async function deletionPolicy() {
  const o = await getOps();
  return { paidTickets: o.deletedUserPaidTickets, membershipRefund: o.deletedMembershipRefund };
}

/** Public contact details. Empty strings by default (nothing extra is shown). */
export async function getSiteInfo(): Promise<SiteInfo> {
  const r = siteSchema.safeParse((await rows()).get(SITE_KEY) ?? {});
  return r.success ? r.data : { contactEmail: "", postalAddress: "" };
}
