import type { Prisma } from "@/generated/prisma/client";
import { likeLiteral, searchParam } from "@/lib/validation";

/**
 * Members list (Admin → Members) and its CSV export share these filters, so the export contains exactly what staff see.
 * Tabs: all | pending (application awaiting review) | active (active membership) | other (no membership, or only closed ones:
 * guests and former members). One open membership per person (activeSlot), so "has an active row" = "currently active".
 */
export const MEMBER_FILTERS = ["all", "pending", "active", "other"] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];
export const memberFilter = (v: unknown): MemberFilter => { const s = searchParam(v, 20); return (MEMBER_FILTERS as readonly string[]).includes(s) ? (s as MemberFilter) : "all"; };

/**
 * D1 separation (SPEC_R7 §7): Members manages association accounts only (guest/member). Admin Portal accounts (role "admin")
 * live in Users, and deleted (anonymised) rows are never listed. Every Members action treats an excluded target as "not found".
 */
export const NON_MEMBER_ROLES = ["deleted", "admin"] as const;
/** True when Members may show or act on an account with this role (guest/member; never admin or deleted). */
export const isMembersTarget = (role: string | null | undefined) => !!role && !(NON_MEMBER_ROLES as readonly string[]).includes(role);

/** Case-insensitive, literal (% and _ escaped) search on name, email and organization, limited to guest/member accounts. */
export function memberSearchWhere(q: string): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { role: { notIn: [...NON_MEMBER_ROLES] } };
  if (!q) return base;
  const c = { contains: likeLiteral(q), mode: "insensitive" as const };
  return { ...base, OR: [{ name: c }, { email: c }, { organisation: c }] };
}
export const PENDING_WHERE: Prisma.UserWhereInput = { memberships: { some: { status: "pending_verification" } } };
export const NOT_PENDING_WHERE: Prisma.UserWhereInput = { memberships: { none: { status: "pending_verification" } } };
export const memberTabWhere = (f: MemberFilter): Prisma.UserWhereInput =>
  f === "pending" ? PENDING_WHERE
    : f === "active" ? { memberships: { some: { status: "active" } } }
      : f === "other" ? { memberships: { none: { status: { in: ["pending_verification", "active"] } } } } : {};

/** Search text from the query string: control characters removed, trimmed, capped. */
export const memberQuery = (q: unknown) => searchParam(q, 200);

/** Badge colour for a membership status. */
export const badgeFor = (s: string) => (s === "active" ? "badge-green" : s === "pending_verification" ? "badge-amber" : s === "rejected_verification" ? "badge-red" : "");
/** Status tone (DESIGN fix 1, one tone per meaning): active = available, awaiting a decision = pending, rejected/lapsed/canceled = danger, other ends = neutral. */
export const statusFor = (s: string) => (s === "active" ? "status-available" : s === "pending_verification" || s === "pending" ? "status-pending"
  : s === "rejected_verification" || s === "lapsed" || s === "cancelled" ? "status-danger" : "status-neutral");

/** Fields the list and the CSV read (never the password hash). */
export const LIST_USER_SELECT = {
  id: true, name: true, email: true, organisation: true, role: true, createdAt: true,
} as const satisfies Prisma.UserSelect;
export const LIST_MEMBERSHIP_SELECT = {
  id: true, tierId: true, status: true, createdAt: true, verifiedAt: true, renewsAt: true, eligibilityNote: true, rejectionReason: true, refundStatus: true,
} as const satisfies Prisma.MembershipSelect;
