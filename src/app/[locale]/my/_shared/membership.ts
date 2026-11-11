/**
 * The membership a member's pages describe, read once with the same rules on My membership and Profile & privacy (round 7),
 * so the tier, status and dates can never disagree between the two pages. Read-only: membership changes are staff actions.
 */
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/session";
import { membershipHousekeeping } from "@/lib/membership";
import type { StatusTone } from "@/components/ui/Facet";
import { fmtDate } from "./util";

export type MembershipStatus = "active" | "pending_verification" | "rejected_verification" | "lapsed" | "none";

/**
 * Precedence: active > application under review > (legacy unpaid order → "none") > latest rejected or lapsed membership.
 * Runs the lazy housekeeping first (unpaid orders expire, memberships past the renewal grace period lapse).
 */
export async function membershipState(userId: string) {
  await membershipHousekeeping(userId);
  const [act, pv, pp, rj] = await Promise.all([
    activeMembership(userId),
    db.membership.findFirst({ where: { userId, status: "pending_verification" }, orderBy: { createdAt: "desc" } }),
    db.membership.findFirst({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } }), // legacy unpaid order
    // Latest closed membership worth explaining: a rejected application, or a membership that lapsed (not renewed).
    db.membership.findFirst({ where: { userId, status: { in: ["rejected_verification", "lapsed"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const pendingVer = act ? null : pv;
  const pendingPay = act || pendingVer ? null : pp;
  const closed = act || pendingVer || pendingPay ? null : rj;
  const m = act ?? pendingVer ?? closed; // the membership the status card describes
  const status = (m?.status ?? "none") as MembershipStatus;
  return { act, pendingVer, pendingPay, closed, m, status };
}

/** Status chip tones (DESIGN_FIX1_CLASSES): live = available · needs someone's action = pending · rejected/lapsed = danger. */
export const statusTone = (status: MembershipStatus): StatusTone =>
  ({ active: "available", pending_verification: "pending", rejected_verification: "danger", lapsed: "danger" } as Record<string, StatusTone>)[status] ?? "neutral";

type Dates = { status: string; startsAt: Date | null; renewsAt: Date | null; createdAt: Date };
/**
 * Date facts for a membership, labelled so they never misstate it (member.billingPage keys):
 * active → Member since + Renewal date · lapsed → Started + Renewal was due (only once that date has passed: staff can mark a
 * membership lapsed before its renewal date) · application under review / not approved → Applied on.
 */
export function membershipDates(m: Dates, t: (k: string) => string, locale: string, now = new Date()): [string, string][] {
  const rows: [string, string][] = [];
  if (m.status === "active") {
    if (m.startsAt) rows.push([t("since"), fmtDate(m.startsAt, locale)]);
    if (m.renewsAt) rows.push([t("renews"), fmtDate(m.renewsAt, locale)]);
  } else if (m.status === "lapsed") {
    if (m.startsAt) rows.push([t("started"), fmtDate(m.startsAt, locale)]);
    if (m.renewsAt && +m.renewsAt <= +now) rows.push([t("renewalWasDue"), fmtDate(m.renewsAt, locale)]);
  } else if (m.status === "pending_verification" || m.status === "rejected_verification") {
    rows.push([t("applied"), fmtDate(m.createdAt, locale)]);
  }
  return rows;
}
