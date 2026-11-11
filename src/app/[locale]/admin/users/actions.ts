"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { assertAdminPermission, checkAdminPermission, canAssignRole, canManageUser, type AdminContext } from "@/lib/rbac";
import { setAdminActive, setAdminRole } from "@/lib/account";
import { effectivePermissions, isSubset, SUPER_ADMIN_ROLE_ID } from "@/lib/permissions";
import { checkPassword, cleanText, emailOk, idParam, isUniqueViolation, limits, normEmail, safeLocale } from "@/lib/validation";
import { defaultCountry } from "@/config/site";

/**
 * Admin → Users (round 7, SPEC_R7 §5.2): Admin Portal accounts (User rows with role "admin"). Direct creation only (no invitation,
 * no email). Every action checks users.create / users.edit (rbac.ts), re-reads the target from the DB (only role="admin" rows
 * count; anything else is "not found"), applies the §3.4 rules (no self role/status/password change, no managing someone more
 * powerful, no granting a role more powerful than your own, last active Super Admin protected), and writes an audit row without
 * secrets. Unknown form fields are ignored. Passwords are never echoed, logged or put in a URL.
 */

export type UserFormState = { error?: string; field?: "name" | "email" | "password" | "confirm" | "role"; name?: string; email?: string; roleId?: string };
export type PasswordResetState = { error?: string; field?: "password" | "confirm"; ok?: boolean };

const ROLE_SELECT = { id: true, isSystem: true, permissions: true } as const;
type RoleLike = { id: string; isSystem: boolean; permissions: unknown };
type TargetLike = { id: string; role: string; adminRoleId: string | null; adminRole: RoleLike | null };

/* ── pure helpers (rules) ── */

/** A string form value (a File or a missing field → ""), capped so echoed values stay small. */
const str = (v: FormDataEntryValue | null, max = 400) => (typeof v === "string" ? v.slice(0, max) : "");
/** Email as the rest of the app stores it: control characters stripped, trimmed, lower-cased; null if invalid. */
function parseEmail(v: FormDataEntryValue | null): string | null {
  const e = normEmail(str(v, 1000).replace(/[\u0000-\u001f\u007f]/g, ""));
  return emailOk(e) ? e : null;
}
/**
 * §3.4 rules 3 and 6: why the actor may not manage this target (null = allowed). `allowSelf` for one's own name edit.
 * canManageUser needs a STRICT subset (round-7 S1): a target whose permissions equal the actor's → err_peer.
 */
function manageRefusal(ctx: AdminContext, target: TargetLike, allowSelf: boolean): "err_self" | "err_superOnly" | "err_target" | "err_peer" | null {
  if (target.id === ctx.user.id) return allowSelf ? null : "err_self";
  if (canManageUser(ctx, target)) return null;
  if (target.adminRoleId === SUPER_ADMIN_ROLE_ID) return "err_superOnly";
  return isSubset(effectivePermissions(target.adminRole), ctx.permissions) ? "err_peer" : "err_target";
}
/** §3.4 rule 4: why the actor may not assign this role (null = allowed). */
function assignRefusal(ctx: AdminContext, role: RoleLike): "err_superOnly" | "err_roleNotAllowed" | null {
  if (canAssignRole(ctx, role)) return null;
  return role.id === SUPER_ADMIN_ROLE_ID ? "err_superOnly" : "err_roleNotAllowed";
}

/* ── DB helpers ── */

/** The admin account named by the form's uid (with its role), or null when missing or not an Admin Portal account. */
async function loadTarget(fd: FormData) {
  const id = idParam(fd.get("uid"));
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, include: { adminRole: { select: ROLE_SELECT } } });
  return u && u.role === "admin" ? u : null;
}
async function loadRole(fd: FormData) {
  const id = idParam(fd.get("roleId"));
  return id ? db.adminRole.findUnique({ where: { id }, select: ROLE_SELECT }) : null;
}
/** Redirect-style guard: users.edit, then the target (missing or not an admin → the list with ?msg=notFound). */
async function editGuard(fd: FormData) {
  const { locale, ctx } = await assertAdminPermission(fd, "users", "edit");
  const u = await loadTarget(fd);
  if (!u) redirect(`/${locale}/admin/users?msg=notFound`);
  return { locale, ctx, u };
}
/** Back to the user page with a notice (adminUsers.<msg>). The id always comes from the DB. */
function back(locale: string, userId: string, msg: string, anchor: string): never {
  redirect(`/${locale}/admin/users/${encodeURIComponent(userId)}?msg=${msg}#${anchor}`);
}
const audit = (actor: string, action: string, target: string) => db.auditLog.create({ data: { actor, action, target } });

/* ── create ── */

/** Create an Admin Portal account directly: usable at once with the typed password. Validation order per SPEC §5.2. */
export async function createAdminUser(_: UserFormState, fd: FormData): Promise<UserFormState> {
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "adminUsers" });
  const typed = { name: str(fd.get("name")), email: str(fd.get("email")), roleId: idParam(fd.get("roleId")) };
  const fail = (key: string, field?: UserFormState["field"]): UserFormState => ({ error: t(key), ...(field ? { field } : {}), ...typed });
  const g = await checkAdminPermission("users", "create");
  if (!g.ok) return fail(g.reason === "signedOut" ? "err_session" : "err_forbidden");
  const { ctx } = g;
  const name = cleanText(fd.get("name"), limits.name); if (!name) return fail("err_name", "name");
  const email = parseEmail(fd.get("email")); if (!email) return fail("err_email", "email");
  const password = str(fd.get("password"), 10_000), confirm = str(fd.get("confirm"), 10_000);
  const pwErr = checkPassword(password, email); if (pwErr) return fail(`err_pw_${pwErr}`, "password");
  if (password !== confirm) return fail("err_pwMismatch", "confirm");
  const role = await loadRole(fd); if (!role) return fail("err_role", "role");
  const refusal = assignRefusal(ctx, role); if (refusal) return fail(refusal, "role");
  // Unique across ALL accounts (member, guest, admin, retained deleted rows). Checked after validation (no existence oracle).
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) return fail("err_emailTaken", "email");
  const passwordHash = await bcrypt.hash(password, 10);
  let id: string;
  try {
    id = await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, name, passwordHash, role: "admin", adminRoleId: role.id, active: true, country: defaultCountry, locale: "en" }, select: { id: true } });
      await tx.loginThrottle.deleteMany({ where: { key: `e:${email}` } }); // a stale lock on a reused address
      await tx.auditLog.create({ data: { actor: ctx.user.id, action: "admin_user.created", target: `${u.id} (role: ${role.id})` } });
      return u.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("err_emailTaken", "email");
    throw e;
  }
  redirect(`/${locale}/admin/users/${encodeURIComponent(id)}?msg=msg_created`);
}

/* ── details (name, email) ── */

/**
 * Name and email. Own name may be edited here, own email not (round-7 S2 / SEC L-1: no sign-in email change without
 * re-authentication; another authorized admin changes it): a missing email field keeps it, a different one → err_emailSelf.
 * Someone else's details only if canManageUser. The write is conditional on the target's role and email being unchanged
 * since that check (S3 / SEC L-2): a concurrent promotion or re-email → err_conflict, nothing written.
 */
export async function updateAdminUser(fd: FormData): Promise<void> {
  const { locale, ctx, u } = await editGuard(fd);
  const self = u.id === ctx.user.id;
  const refusal = manageRefusal(ctx, u, true); if (refusal) back(locale, u.id, refusal, "details");
  const name = cleanText(fd.get("name"), limits.name); if (!name) back(locale, u.id, "err_name", "details");
  const email = self && fd.get("email") === null ? u.email : parseEmail(fd.get("email"));
  if (!email) back(locale, u.id, "err_email", "details");
  if (self && email !== u.email) {
    await audit(ctx.user.id, "admin_user.email_change_refused_self", u.id);
    back(locale, u.id, "err_emailSelf", "details");
  }
  if (name === u.name && email === u.email) back(locale, u.id, "msg_noChange", "details");
  const emailChanged = email !== u.email;
  if (emailChanged && (await db.user.findUnique({ where: { email }, select: { id: true } }))) back(locale, u.id, "err_emailTaken", "details");
  let ok: boolean;
  try {
    ok = await db.$transaction(async (tx) => {
      // Pinned to what was checked: same role (canManageUser) and same email (the throttle move below).
      const r = await tx.user.updateMany({ where: { id: u.id, role: "admin", adminRoleId: u.adminRoleId, email: u.email }, data: { name, email } });
      if (!r.count) return false;
      if (emailChanged) { // login lockouts are keyed by email: move the counter to the new address
        await tx.loginThrottle.deleteMany({ where: { key: `e:${email}` } });
        await tx.loginThrottle.updateMany({ where: { key: `e:${u.email}` }, data: { key: `e:${email}` } });
      }
      await tx.auditLog.create({ data: { actor: ctx.user.id, action: "admin_user.updated", target: u.id } });
      if (emailChanged) await tx.auditLog.create({ data: { actor: ctx.user.id, action: "admin_user.email_changed", target: u.id } });
      return true;
    });
  } catch (e) {
    if (isUniqueViolation(e)) back(locale, u.id, "err_emailTaken", "details");
    throw e;
  }
  if (!ok) {
    if (!(await loadTarget(fd))) redirect(`/${locale}/admin/users?msg=notFound`);
    back(locale, u.id, "err_conflict", "details");
  }
  back(locale, u.id, "msg_saved", "details");
}

/* ── role ── */

/** Give another Admin Portal role. Not yourself; not someone more powerful; not a role more powerful than yours. Bumps sessionVersion. */
export async function changeAdminUserRole(fd: FormData): Promise<void> {
  const { locale, ctx, u } = await editGuard(fd);
  const refusal = manageRefusal(ctx, u, false); if (refusal) back(locale, u.id, refusal, "role");
  const role = await loadRole(fd); if (!role) back(locale, u.id, "err_role", "role");
  const notAllowed = assignRefusal(ctx, role); if (notAllowed) back(locale, u.id, notAllowed, "role");
  // expectedAdminRoleId: refuse if the target's role changed since canManageUser checked it (race-safe; re-read under FOR UPDATE)
  const r = await setAdminRole(u.id, role.id, { expectedAdminRoleId: u.adminRoleId }); // locks active Super Admins + target; bumps sessionVersion on a real change
  if (r === "notFound") redirect(`/${locale}/admin/users?msg=notFound`);
  if (r === "conflict") back(locale, u.id, "err_target", "role");
  if (r === "badRole") back(locale, u.id, "err_role", "role");
  if (r === "lastSuperAdmin") {
    await audit(ctx.user.id, "admin_user.change_blocked_last_super_admin", u.id);
    back(locale, u.id, "err_lastSuperAdmin", "role");
  }
  if (r === "unchanged") back(locale, u.id, "msg_noChange", "role");
  await audit(ctx.user.id, "admin_user.role_changed", `${u.id} (role: ${role.id})`);
  back(locale, u.id, "msg_roleChanged", "role");
}

/* ── status ── */

/** Deactivate (confirm=on; bumps sessionVersion) or reactivate. Not yourself; last active Super Admin protected. */
export async function setAdminUserActive(fd: FormData): Promise<void> {
  const { locale, ctx, u } = await editGuard(fd);
  const to = fd.get("to");
  if (to !== "active" && to !== "inactive") back(locale, u.id, "msg_noChange", "status");
  const refusal = manageRefusal(ctx, u, false); if (refusal) back(locale, u.id, refusal, "status");
  const active = to === "active";
  if (!active && fd.get("confirm") !== "on") back(locale, u.id, "err_confirm", "status");
  const r = await setAdminActive(u.id, active, { expectedAdminRoleId: u.adminRoleId });
  if (r === "notFound") redirect(`/${locale}/admin/users?msg=notFound`);
  if (r === "conflict") back(locale, u.id, "err_target", "status");
  if (r === "lastSuperAdmin") {
    await audit(ctx.user.id, "admin_user.change_blocked_last_super_admin", u.id);
    back(locale, u.id, "err_lastSuperAdmin", "status");
  }
  if (r !== "changed") back(locale, u.id, "msg_noChange", "status");
  await audit(ctx.user.id, active ? "admin_user.activated" : "admin_user.deactivated", u.id);
  back(locale, u.id, active ? "msg_activated" : "msg_deactivated", "status");
}

/* ── password ── */

/** Set a new password (typed twice, policy-checked). Ends the user's sessions (sessionVersion). Never echoed. */
export async function resetAdminUserPassword(_: PasswordResetState, fd: FormData): Promise<PasswordResetState> {
  const locale = safeLocale(fd.get("locale"));
  const t = await getTranslations({ locale, namespace: "adminUsers" });
  const g = await checkAdminPermission("users", "edit");
  if (!g.ok) return { error: t(g.reason === "signedOut" ? "err_session" : "err_forbidden") };
  const { ctx } = g;
  const u = await loadTarget(fd); if (!u) return { error: t("err_notFound") };
  const refusal = manageRefusal(ctx, u, false); if (refusal) return { error: t(refusal) };
  const password = str(fd.get("password"), 10_000), confirm = str(fd.get("confirm"), 10_000);
  const pwErr = checkPassword(password, u.email); if (pwErr) return { error: t(`err_pw_${pwErr}`), field: "password" };
  if (password !== confirm) return { error: t("err_pwMismatch"), field: "confirm" };
  const passwordHash = await bcrypt.hash(password, 10);
  // Conditional on the role checked above: a concurrent promotion of the target makes this a no-op instead of an escalation.
  const r = await db.user.updateMany({ where: { id: u.id, role: "admin", adminRoleId: u.adminRoleId, email: u.email }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  if (!r.count) return { error: t("err_notFound") };
  await audit(ctx.user.id, "admin_user.password_reset", u.id);
  return { ok: true };
}

/* ── unlock ── */

/** Clear a login lock (failed sign-ins). Reuses the existing audit action auth.account_unlocked. */
export async function unlockAdminUser(fd: FormData): Promise<void> {
  const { locale, ctx, u } = await editGuard(fd);
  const refusal = manageRefusal(ctx, u, false); if (refusal) back(locale, u.id, refusal, "status"); // not oneself (as in the UI)
  // Pinned to what was checked (S3 / SEC L-2): the target row is locked and must still have the same role and email.
  const r = await db.$transaction(async (tx) => {
    const still = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${u.id} AND role = 'admin' AND email = ${u.email}
        AND "adminRoleId" IS NOT DISTINCT FROM ${u.adminRoleId} FOR UPDATE`;
    return still.length ? tx.loginThrottle.deleteMany({ where: { key: `e:${u.email}` } }) : null;
  });
  if (!r) back(locale, u.id, "err_conflict", "status");
  await audit(ctx.user.id, "auth.account_unlocked", u.id + (r.count ? "" : " (no lock)"));
  back(locale, u.id, "msg_unlocked", "status");
}
