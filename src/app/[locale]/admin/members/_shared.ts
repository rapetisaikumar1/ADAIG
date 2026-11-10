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

/** Case-insensitive, literal (% and _ escaped) search on name, email and organization, plus "not deleted". */
export function memberSearchWhere(q: string): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { role: { not: "deleted" } };
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

/** Fields the list and the CSV read (never the password hash). */
export const LIST_USER_SELECT = {
  id: true, name: true, email: true, organisation: true, role: true, createdAt: true,
} as const satisfies Prisma.UserSelect;
export const LIST_MEMBERSHIP_SELECT = {
  id: true, tierId: true, status: true, createdAt: true, verifiedAt: true, renewsAt: true, eligibilityNote: true, rejectionReason: true, refundStatus: true,
} as const satisfies Prisma.MembershipSelect;
