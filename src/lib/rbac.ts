import { cache } from "react";
import { redirect } from "next/navigation";
import type { AdminRole, User } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { safeLocale } from "@/lib/validation";
import type { Locale } from "@/config/site";
import { currentPath, loginPath, portalHome, requireUser } from "@/lib/session";
import {
  canPerm, effectivePermissions, isSubset, NO_ACCESS_PATH, SUPER_ADMIN_ROLE_ID,
  type Action, type Module, type Permissions,
} from "@/lib/permissions";

/**
 * Admin Portal RBAC guards (round 7, SPEC_R7 §3–§4.2). Server-only. Every admin page, server action and API route checks a
 * (module, action) permission here; the UI only mirrors the result. Permissions are re-read from the DB on every request
 * (never trusted from the JWT), so role edits apply on the next request.
 */
export type AdminContext = { user: User; role: AdminRole | null; permissions: Permissions; isSuperAdmin: boolean };

type RoleLike = { id: string; isSystem: boolean; permissions: unknown };

/** Signed-in, active, role='admin' user with effective permissions; null otherwise. Memoized per request (React cache). */
export const getAdminContext: () => Promise<AdminContext | null> = cache(async () => {
  const s = await auth();
  if (!s?.user?.id) return null;
  const u = await db.user.findUnique({ where: { id: s.user.id }, include: { adminRole: true } });
  if (!u || u.role !== "admin" || !u.active) return null;
  const { adminRole, ...user } = u;
  return {
    user: user as User,
    role: adminRole,
    permissions: effectivePermissions(adminRole),
    isSuperAdmin: adminRole?.id === SUPER_ADMIN_ROLE_ID && adminRole.isSystem,
  };
});

export function can(ctx: AdminContext | null | undefined, m: Module, a: Action): boolean {
  return canPerm(ctx?.permissions, m, a);
}

/** Pages: signed out → login?next=… ; member/guest → /<locale>/my/billing (as today) ; active admin → ctx. */
export const requireAdminContext: (locale: string, nextPath?: string) => Promise<AdminContext> = cache(async (locale: string, nextPath?: string) => {
  const u = await requireUser(locale, nextPath);
  if (u.role !== "admin") redirect(portalHome(locale, u.role, null));
  const ctx = await getAdminContext();
  if (!ctx) redirect(loginPath(locale, nextPath ?? (await currentPath())));
  return ctx;
});

/** Pages: requireAdminContext, then without the permission → redirect(`/${locale}/admin/no-access`). No audit row for page loads. */
export async function requireAdminPermission(locale: string, m: Module, a: Action, nextPath?: string): Promise<AdminContext> {
  const ctx = await requireAdminContext(locale, nextPath);
  if (!can(ctx, m, a)) redirect(`/${locale}${NO_ACCESS_PATH}`);
  return ctx;
}

const auditDenied = (ctx: AdminContext, m: Module, a: Action) =>
  db.auditLog.create({ data: { actor: ctx.user.id, action: "admin.permission_denied", target: `${m}.${a}` } });

/**
 * Form actions (redirect style). locale = safeLocale(fd.get("locale")).
 * Not an active admin → redirect(`/${locale}/login`) (unchanged for member/guest/visitor replays: 303 → /login).
 * Admin without permission → audit { actor: ctx.user.id, action: "admin.permission_denied", target: `${m}.${a}` },
 * then redirect(`/${locale}/admin/no-access`).
 */
export async function assertAdminPermission(fd: FormData, m: Module, a: Action): Promise<{ locale: Locale; ctx: AdminContext }> {
  const locale = safeLocale(fd.get("locale")) as Locale;
  const ctx = await getAdminContext();
  if (!ctx) redirect(`/${locale}/login`);
  if (!can(ctx, m, a)) {
    await auditDenied(ctx, m, a);
    redirect(`/${locale}${NO_ACCESS_PATH}`);
  }
  return { locale, ctx };
}

/** useActionState actions: same checks, no redirect; the caller returns { error: t("err_session") | t("err_forbidden") }. */
export async function checkAdminPermission(m: Module, a: Action): Promise<{ ok: true; ctx: AdminContext } | { ok: false; reason: "signedOut" | "forbidden" }> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, reason: "signedOut" };
  if (!can(ctx, m, a)) {
    await auditDenied(ctx, m, a);
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, ctx };
}

/** Route handlers: ctx, or Response 403 "forbidden" (cache-control: no-store). Admin without permission is audited. */
export async function apiAdminPermission(m: Module, a: Action): Promise<AdminContext | Response> {
  const forbidden = () => new Response("forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  const ctx = await getAdminContext();
  if (!ctx) return forbidden();
  if (!can(ctx, m, a)) { await auditDenied(ctx, m, a); return forbidden(); }
  return ctx;
}

/** §3.4 rule 4: the Super Admin role only by a Super Admin; any other role only if its permissions are a subset of the actor's. */
export function canAssignRole(ctx: AdminContext, role: RoleLike): boolean {
  return role.id === SUPER_ADMIN_ROLE_ID ? ctx.isSuperAdmin : isSubset(effectivePermissions(role), ctx.permissions);
}

/**
 * §3.4 rule 6 (tightened in round-7 fix S1 / SEC M-1): Super Admins manage anyone; others only non-Super targets whose
 * permissions are a STRICT subset of their own (everything the target holds, the actor holds, and the actor holds more).
 * Peers with equal permissions can't manage each other (no password reset, re-email, role or status change, unlock).
 * Callers handle "oneself" separately (rule 3) before calling this.
 */
export function canManageUser(ctx: AdminContext, target: { id: string; role: string; adminRoleId: string | null; adminRole: RoleLike | null }): boolean {
  if (ctx.isSuperAdmin) return true;
  const targetIsSuper = target.role === "admin" && target.adminRoleId === SUPER_ADMIN_ROLE_ID;
  if (targetIsSuper) return false;
  const targetPerms = effectivePermissions(target.adminRole);
  return isSubset(targetPerms, ctx.permissions) && !isSubset(ctx.permissions, targetPerms);
}

/** §3.4 rule 7: never the system role or the actor's own role; otherwise only roles whose permissions the actor fully holds. */
export function canManageRole(ctx: AdminContext, role: RoleLike): boolean {
  return !role.isSystem && role.id !== ctx.role?.id && isSubset(effectivePermissions(role), ctx.permissions);
}
