import type { Prisma } from "@/generated/prisma/client";
import { likeLiteral, searchParam } from "@/lib/validation";
import { SUPER_ADMIN_ROLE_ID } from "@/lib/permissions";

/**
 * Admin → Users (round 7, SPEC_R7 §5.1): Admin Portal accounts only (`role = "admin"`). Association members and guests live in
 * Members. Tabs: all | active | inactive (deactivated). Search: literal, case-insensitive, on name and email.
 */
export const USER_FILTERS = ["all", "active", "inactive"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
export const userFilter = (v: unknown): UserFilter => { const s = searchParam(v, 20); return (USER_FILTERS as readonly string[]).includes(s) ? (s as UserFilter) : "all"; };
export const userQuery = (q: unknown) => searchParam(q, 200);

export const USERS_BASE: Prisma.UserWhereInput = { role: "admin" };
export function userSearchWhere(q: string): Prisma.UserWhereInput {
  if (!q) return {};
  const c = { contains: likeLiteral(q), mode: "insensitive" as const };
  return { OR: [{ name: c }, { email: c }] };
}
export const userTabWhere = (f: UserFilter): Prisma.UserWhereInput => (f === "active" ? { active: true } : f === "inactive" ? { active: false } : {});

/** Role list order everywhere (selects, list): Super Admin first, then by name. */
export const roleOrder = <R extends { id: string; name: string }>(list: R[]) =>
  [...list].sort((a, b) => (a.id === SUPER_ADMIN_ROLE_ID ? -1 : b.id === SUPER_ADMIN_ROLE_ID ? 1 : a.name.localeCompare(b.name)));

export const isSuperRole = (id: string | null | undefined) => id === SUPER_ADMIN_ROLE_ID;
