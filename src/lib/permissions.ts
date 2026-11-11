// Admin Portal permission model (round 7, SPEC_R7 §3–§4.1): modules × actions, stored as JSON on AdminRole.permissions.
// Pure module: NO "@/" imports and no db/next imports. It is imported by src/auth.ts, client components, prisma/seed.ts (relative
// import) and tests. Every reader goes through normalizePermissions/effectivePermissions, which fail closed: malformed data grants nothing.

export const MODULES = ["members", "events", "messages", "users", "roles", "system"] as const;
export type Module = (typeof MODULES)[number];
export const ACTIONS = ["view", "create", "edit", "delete"] as const;
export type Action = (typeof ACTIONS)[number];
export const MODULE_ACTIONS: { readonly [M in Module]: readonly Action[] } = {
  members: ["view", "create", "edit", "delete"],
  events: ["view", "create", "edit", "delete"],
  messages: ["view", "edit"],
  users: ["view", "create", "edit"],
  roles: ["view", "create", "edit", "delete"],
  system: ["view", "edit"],
};
export type Permissions = { [M in Module]?: Action[] };

export const SUPER_ADMIN_ROLE_ID = "sys_super_admin";
export const SUPER_ADMIN_NAME = "Super Admin";

/** Every module with every applicable action (what the Super Admin system role always has). Frozen. */
export const FULL_PERMISSIONS: Permissions = Object.freeze(
  Object.fromEntries(MODULES.map((m) => [m, Object.freeze([...MODULE_ACTIONS[m]]) as Action[]])) as Permissions,
);

const isModule = (v: unknown): v is Module => typeof v === "string" && (MODULES as readonly string[]).includes(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * Canonical permissions from anything (stored JSON, form data…). Not a plain object → {}. Unknown modules, non-array values and
 * unknown/not-applicable actions are dropped; duplicates removed; create/edit/delete imply view; canonical module and action order;
 * modules without actions omitted.
 */
export function normalizePermissions(raw: unknown): Permissions {
  if (!isPlainObject(raw)) return {};
  const out: Permissions = {};
  for (const m of MODULES) {
    if (!Object.prototype.hasOwnProperty.call(raw, m)) continue;
    const v = raw[m];
    if (!Array.isArray(v)) continue;
    const allowed = MODULE_ACTIONS[m];
    const set = new Set<Action>();
    for (const a of v) if (typeof a === "string" && (allowed as readonly string[]).includes(a)) set.add(a as Action);
    if (set.size && allowed.includes("view") && [...set].some((a) => a !== "view")) set.add("view");
    if (set.size) out[m] = allowed.filter((a) => set.has(a));
  }
  return out;
}

/** Checkbox form encoding: name="perm" value="<module>:<action>". */
export function permissionsFromForm(fd: FormData): Permissions {
  const grouped: Record<string, string[]> = {};
  for (const v of fd.getAll("perm")) {
    if (typeof v !== "string") continue;
    const i = v.indexOf(":");
    if (i <= 0) continue;
    const m = v.slice(0, i), a = v.slice(i + 1);
    if (!isModule(m)) continue;
    (grouped[m] ??= []).push(a);
  }
  return normalizePermissions(grouped);
}

export function canPerm(p: Permissions | null | undefined, m: Module, a: Action): boolean {
  return !!p?.[m]?.includes(a);
}

/** True when every action in `a` is also in `b`. */
export function isSubset(a: Permissions, b: Permissions): boolean {
  return MODULES.every((m) => (a[m] ?? []).every((x) => canPerm(b, m, x)));
}

/** Effective permissions of a role: none → {}; the Super Admin system role → FULL_PERMISSIONS; else the normalised stored JSON. */
export function effectivePermissions(role: { id: string; isSystem: boolean; permissions: unknown } | null | undefined): Permissions {
  if (!role) return {};
  if (role.id === SUPER_ADMIN_ROLE_ID && role.isSystem) return FULL_PERMISSIONS;
  return normalizePermissions(role.permissions);
}

/** Roles list summary for one module: every action → full; only view → view; nothing → none; else custom. */
export function moduleLevel(p: Permissions, m: Module): "full" | "view" | "custom" | "none" {
  const acts = p[m] ?? [];
  if (!acts.length) return "none";
  if (MODULE_ACTIONS[m].every((a) => acts.includes(a))) return "full";
  if (acts.length === 1 && acts[0] === "view") return "view";
  return "custom";
}

/** Sidebar / landing order (D8), then the hidden system pages. Paths are locale-less. */
export const ADMIN_SECTIONS: readonly { module: Module; path: string }[] = [
  { module: "members", path: "/admin/members" },
  { module: "events", path: "/admin/events" },
  { module: "messages", path: "/admin/messages" },
  { module: "users", path: "/admin/users" },
  { module: "roles", path: "/admin/roles" },
  { module: "system", path: "/admin/dashboard" },
];
export const NO_ACCESS_PATH = "/admin/no-access";

/** Admin landing (locale-less): the first ADMIN_SECTIONS entry the permissions can view, else NO_ACCESS_PATH. */
export function adminHomePath(p: Permissions | null | undefined): string {
  return ADMIN_SECTIONS.find((s) => canPerm(p, s.module, "view"))?.path ?? NO_ACCESS_PATH;
}
