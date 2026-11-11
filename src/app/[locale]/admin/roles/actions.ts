"use server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertAdminPermission, checkAdminPermission, canManageRole, type AdminContext } from "@/lib/rbac";
import { isSubset, MODULES, normalizePermissions, permissionsFromForm, SUPER_ADMIN_NAME, SUPER_ADMIN_ROLE_ID, type Permissions } from "@/lib/permissions";
import { cleanText, idParam, isUniqueViolation, safeLocale } from "@/lib/validation";
import { cleanRoleName, roleNameSkeleton, sameRoleName } from "@/lib/roleName";

/**
 * Admin → Roles (round 7, SPEC_R7 §5.3): create, edit and delete Admin Portal roles (name, description, permission JSON).
 * roles.create / roles.edit / roles.delete are checked (rbac.ts). Super Admin (isSystem) is immutable; your own role and roles
 * with permissions you don't hold can't be changed; you can't grant permissions you don't hold; a role in use can't be deleted
 * (also enforced by the FK RESTRICT). Permissions are always stored normalised. No sessionVersion bump: the session callback
 * re-reads permissions on every request, so assigned users get the change on their next page load.
 */

export type RoleFormState = { error?: string; field?: "name" | "description" | "perms"; name?: string; description?: string; perms?: string[] /* "<m>:<a>" */ };

const NAME_MAX = 60, NAME_MIN = 2, DESC_MAX = 300;
type RoleLike = { id: string; isSystem: boolean; permissions: unknown };

/* ── pure helpers ── */

const str = (v: FormDataEntryValue | null, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");
/** Permissions → the checkbox values ("<module>:<action>") in canonical order. */
const permList = (p: Permissions) => MODULES.flatMap((m) => (p[m] ?? []).map((a) => `${m}:${a}`));
const isSystemRole = (r: RoleLike) => r.isSystem || r.id === SUPER_ADMIN_ROLE_ID;
/** §3.4 rules 1 and 7: why the actor may not change or delete this role (null = allowed). */
function roleRefusal(ctx: AdminContext, role: RoleLike): "err_systemRole" | "err_ownRole" | "err_target" | null {
  if (isSystemRole(role)) return "err_systemRole";
  if (role.id === ctx.role?.id) return "err_ownRole";
  return canManageRole(ctx, role) ? null : "err_target";
}

type Parsed = { ok: true; name: string; description: string | null; perms: Permissions } | { ok: false; key: string; field?: RoleFormState["field"]; values?: Record<string, string> };
/**
 * Name (2–60; round-7 S5 / SEC L-4: NFKC-normalised, no invisible/format characters, one alphabet — src/lib/roleName.ts — and
 * unique on its lookalike skeleton, which also reserves "Super Admin" and its lookalikes), description (≤300 or blank),
 * perms ⊆ actor's (rule 5).
 */
async function parseRoleForm(fd: FormData, ctx: AdminContext, perms: Permissions, current?: { id: string; name: string }): Promise<Parsed> {
  const checked = cleanRoleName(fd.get("name"), NAME_MIN, NAME_MAX);
  if (!checked.ok) return { ok: false, key: checked.reason === "chars" ? "err_nameChars" : "err_name", field: "name" };
  const name = checked.name;
  const rawDesc = str(fd.get("description"), 10_000);
  let description: string | null = null;
  if (rawDesc.trim()) { description = cleanText(rawDesc, DESC_MAX); if (!description) return { ok: false, key: "err_description", field: "description" }; }
  if (!isSubset(perms, ctx.permissions)) return { ok: false, key: "err_escalation", field: "perms" };
  // Small table: compare in JS so the check is literal and case-insensitive whatever SQL Prisma generates. The system role's
  // name is always included (even if its row were renamed), so it can never be imitated.
  const others = await db.adminRole.findMany({ where: current ? { id: { not: current.id } } : {}, select: { name: true } });
  const names = [SUPER_ADMIN_NAME, ...others.map((r) => r.name)];
  if (names.some((n) => sameRoleName(n, name))) return { ok: false, key: "err_nameTaken", field: "name" };
  // An unchanged name is not re-judged against older lookalikes (a permission edit is never blocked by the role's own name).
  const skel = roleNameSkeleton(name);
  const similar = current?.name === name ? undefined : names.find((n) => roleNameSkeleton(n) === skel);
  if (similar) return { ok: false, key: "err_nameSimilar", field: "name", values: { name: similar } };
  return { ok: true, name, description, perms };
}
const asJson = (p: Permissions) => p as Prisma.InputJsonValue;

/* ── create ── */

export async function createRole(_: RoleFormState, fd: FormData): Promise<RoleFormState> {
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "adminRoles" });
  const perms = permissionsFromForm(fd);
  const typed = { name: str(fd.get("name"), 200), description: str(fd.get("description"), 2000), perms: permList(perms) };
  const fail = (key: string, field?: RoleFormState["field"], values?: Record<string, string>): RoleFormState => ({ error: t(key, values), ...(field ? { field } : {}), ...typed });
  const g = await checkAdminPermission("roles", "create");
  if (!g.ok) return fail(g.reason === "signedOut" ? "err_session" : "err_forbidden");
  const { ctx } = g;
  const p = await parseRoleForm(fd, ctx, perms);
  if (!p.ok) return fail(p.key, p.field, p.values);
  let id: string;
  try {
    id = await db.$transaction(async (tx) => {
      const r = await tx.adminRole.create({ data: { name: p.name, description: p.description, permissions: asJson(p.perms), isSystem: false }, select: { id: true } });
      await tx.auditLog.create({ data: { actor: ctx.user.id, action: "admin_role.created", target: r.id } });
      return r.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("err_nameTaken", "name");
    throw e;
  }
  redirect(`/${locale}/admin/roles/${encodeURIComponent(id)}?msg=msg_created`);
}

/* ── update ── */

/** Optimistic concurrency: hidden `v` = the role's updatedAt (ISO) when the form was rendered; a mismatch → err_conflict. */
export async function updateRole(_: RoleFormState, fd: FormData): Promise<RoleFormState> {
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "adminRoles" });
  const perms = permissionsFromForm(fd);
  const typed = { name: str(fd.get("name"), 200), description: str(fd.get("description"), 2000), perms: permList(perms) };
  const fail = (key: string, field?: RoleFormState["field"], values?: Record<string, string>): RoleFormState => ({ error: t(key, values), ...(field ? { field } : {}), ...typed });
  const g = await checkAdminPermission("roles", "edit");
  if (!g.ok) return fail(g.reason === "signedOut" ? "err_session" : "err_forbidden");
  const { ctx } = g;
  const id = idParam(fd.get("id"));
  const role = id ? await db.adminRole.findUnique({ where: { id } }) : null;
  if (!role) return fail("err_notFound");
  const refusal = roleRefusal(ctx, role); if (refusal) return fail(refusal);
  const p = await parseRoleForm(fd, ctx, perms, role);
  if (!p.ok) return fail(p.key, p.field, p.values);
  const v = new Date(str(fd.get("v"), 64));
  if (Number.isNaN(v.getTime())) return fail("err_conflict");
  const permsChanged = JSON.stringify(normalizePermissions(role.permissions)) !== JSON.stringify(p.perms);
  let count: number;
  try {
    count = await db.$transaction(async (tx) => {
      const r = await tx.adminRole.updateMany({ where: { id: role.id, isSystem: false, updatedAt: v }, data: { name: p.name, description: p.description, permissions: asJson(p.perms) } });
      if (!r.count) return 0;
      await tx.auditLog.create({ data: { actor: ctx.user.id, action: "admin_role.updated", target: role.id } });
      if (permsChanged) await tx.auditLog.create({ data: { actor: ctx.user.id, action: "admin_role.permissions_changed", target: role.id } });
      return r.count;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("err_nameTaken", "name");
    throw e;
  }
  if (!count) return fail("err_conflict");
  redirect(`/${locale}/admin/roles/${encodeURIComponent(role.id)}?msg=msg_saved`);
}

/* ── delete ── */

const isFkViolation = (e: unknown) => (e as { code?: string })?.code === "P2003";

/** Delete a role that no user has (confirm=on). Refusals go back to the role page's #delete section with ?msg=<key>. */
export async function deleteRole(fd: FormData): Promise<void> {
  const { locale, ctx } = await assertAdminPermission(fd, "roles", "delete");
  const id = idParam(fd.get("id"));
  const role = id ? await db.adminRole.findUnique({ where: { id } }) : null;
  if (!role) redirect(`/${locale}/admin/roles?msg=notFound`);
  const back = (msg: string): never => redirect(`/${locale}/admin/roles/${encodeURIComponent(role.id)}?msg=${msg}#delete`);
  const refusal = roleRefusal(ctx, role); if (refusal) back(refusal);
  if (fd.get("confirm") !== "on") back("err_confirm");
  let deleted: boolean;
  try {
    // One statement: the role must still exist, not be a system role, and have no users (the FK RESTRICT covers a race).
    deleted = (await db.adminRole.deleteMany({ where: { id: role.id, isSystem: false, users: { none: {} } } })).count > 0;
  } catch (e) {
    if (!isFkViolation(e)) throw e;
    deleted = false;
  }
  if (!deleted) {
    if (!(await db.adminRole.findUnique({ where: { id: role.id }, select: { id: true } }))) redirect(`/${locale}/admin/roles?msg=notFound`);
    await db.auditLog.create({ data: { actor: ctx.user.id, action: "admin_role.delete_blocked_in_use", target: role.id } });
    back("err_inUse");
  }
  await db.auditLog.create({ data: { actor: ctx.user.id, action: "admin_role.deleted", target: role.id } });
  redirect(`/${locale}/admin/roles?msg=msg_deleted`);
}
