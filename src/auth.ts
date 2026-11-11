import { cache } from "react";
import NextAuth, { CredentialsSignin, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { reserveAttempt, recordIpFailure, clearFailures, clientIp, ipDelay } from "@/lib/rateLimit";
import { emailOk, hasCtl, auditTarget } from "@/lib/validation";
import { effectivePermissions, type Permissions } from "@/lib/permissions";

declare module "next-auth" {
  // permissions: the Admin Portal role's effective permissions (re-read from the DB on every request; null for non-admins).
  interface Session { user: { id: string; name: string; email: string; role: string; active: boolean; adminRoleId: string | null; permissions: Permissions | null } }
}
class LockedError extends CredentialsSignin { code = "locked"; }
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.hNnL1E0n6cYb5RkXz1qC5U5bXkGm"; // equalises timing for unknown emails

const nextAuth = NextAuth({
  secret: serverEnv().AUTH_SECRET, // validated in src/lib/env.ts (required in production)
  // 7-day sessions, rolling: the cookie is re-issued (and the 7 days restart) at most once a day while the visitor is active
  // (coordinator decision F3/S1-7). Sign-out stays per-device; password reset/change end all sessions via sessionVersion.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/en/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(c, request) {
        const email = String(c?.email ?? "").toLowerCase().trim();
        const password = String(c?.password ?? "");
        const ip = clientIp(request.headers);
        await ipDelay(ip);
        // Not an address any account can have (accounts are only created with valid emails): same work and answer as a wrong
        // password, but no throttle or audit rows, so anonymous junk can't fill those tables.
        if (email.length > 254 || hasCtl(email) || !emailOk(email)) { await bcrypt.compare(password, DUMMY_HASH); return null; }
        // Counted before the password check, atomically: parallel attempts can't bypass the lock (src/lib/rateLimit.ts).
        if (!(await reserveAttempt(email))) throw new LockedError();
        const user = await db.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok) {
          await recordIpFailure(ip);
          await db.auditLog.create({ data: { actor: auditTarget(ip ?? "unknown-ip"), action: "auth.login_failed", target: auditTarget(email) } });
          return null;
        }
        // Deactivated (Admin → Users): same bcrypt work, same answer and message as a wrong password, so the response doesn't reveal
        // that the account exists. Failures are NOT cleared (the attempt still counts toward the lock).
        if (user.active === false) {
          await recordIpFailure(ip);
          await db.auditLog.create({ data: { actor: auditTarget(ip ?? "unknown-ip"), action: "auth.login_blocked_inactive", target: auditTarget(email) } });
          return null;
        }
        await clearFailures(email);
        return { id: user.id, name: user.name, email: user.email, sessionVersion: user.sessionVersion } as never;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) { token.id = (user as { id: string }).id; token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0; }
      return token;
    },
    // Role, status and Admin Portal permissions are NOT trusted from the token: they are re-read from the DB on every session
    // lookup (QA BUG-013; round 7 RBAC), so a role edit or a deactivation applies on the user's next request.
    async session({ session, token }) {
      const u = token.id ? await db.user.findUnique({ where: { id: token.id as string }, select: {
        id: true, role: true, name: true, email: true, sessionVersion: true, active: true, adminRoleId: true,
        adminRole: { select: { id: true, isSystem: true, permissions: true } },
      } }) : null;
      // Sessions issued before a password reset / role change / deactivation (sessionVersion bump) are no longer valid, and a
      // deactivated account has no session at all. Tokens from before sessionVersion existed count as 0.
      if (!u || u.role === "deleted" || !u.active || ((token.sv as number | undefined) ?? 0) !== u.sessionVersion) return { ...session, user: undefined as never };
      session.user = { ...session.user, id: u.id, role: u.role, name: u.name, email: u.email, active: u.active, adminRoleId: u.adminRoleId,
        permissions: u.role === "admin" ? effectivePermissions(u.adminRole) : null };
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

/**
 * Current session, memoized per request with React cache() (A1-7/Q1-3): the header, footer and page guards used to decode the JWT
 * and re-read the user row 3–4 times per page. Route handlers get no React cache scope, so calls there always read fresh data.
 * Don't call auth() to observe a change made earlier in the same server action (e.g. after signIn/signOut or a role update).
 */
export const auth: () => Promise<Session | null> = cache(() => nextAuth.auth());
