import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { loginPath, safeNextPath } from "@/lib/nextPath";

export { safeNextPath, loginPath };

/**
 * The page being rendered, as "/<locale>/…?query". src/proxy.ts sets the `x-pathname` / `x-search` request headers on every page
 * request (and server action POST, which targets the page URL). Null when unavailable (e.g. outside a request).
 */
export async function currentPath(): Promise<string | null> {
  try {
    const h = await headers();
    const p = h.get("x-pathname");
    return p ? p + (h.get("x-search") ?? "") : null;
  } catch { return null; }
}

/**
 * Signed-in user (full DB row) or a redirect to /<locale>/login?next=<requested page>. `next` defaults to the current request path
 * (proxy header); pass `nextPath` to send the visitor somewhere else after sign-in. Memoized per request (React cache), so header,
 * footer and page guards share one lookup (auth() itself is memoized in src/auth.ts).
 */
export const requireUser = cache(async (locale: string, nextPath?: string) => {
  const s = await auth();
  const toLogin = async () => redirect(loginPath(locale, nextPath ?? (await currentPath())));
  if (!s?.user?.id) return toLogin();
  const user = await db.user.findUnique({ where: { id: s.user.id } });
  if (!user || user.role === "deleted") return toLogin();
  return user;
});

export const requireAdmin = cache(async (locale: string, nextPath?: string) => {
  const u = await requireUser(locale, nextPath);
  if (u.role !== "admin") redirect(`/${locale}/my/dashboard`);
  return u;
});

export async function activeMembership(userId: string) {
  return db.membership.findFirst({ where: { userId, status: "active" }, orderBy: { createdAt: "desc" } });
}
