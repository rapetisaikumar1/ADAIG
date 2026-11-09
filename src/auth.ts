import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { isLocked, recordFailure, clearFailures, clientIp, ipDelay } from "@/lib/rateLimit";

declare module "next-auth" {
  interface Session { user: { id: string; name: string; email: string; role: string } }
}
class LockedError extends CredentialsSignin { code = "locked"; }
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.hNnL1E0n6cYb5RkXz1qC5U5bXkGm"; // equalises timing for unknown emails

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/en/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(c, request) {
        const email = String(c?.email ?? "").toLowerCase().trim();
        const ip = clientIp(request.headers);
        await ipDelay(ip);
        if (await isLocked(email)) throw new LockedError();
        const user = await db.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(String(c?.password ?? ""), user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok) {
          await recordFailure(email, ip);
          await db.auditLog.create({ data: { actor: ip ?? "unknown-ip", action: "auth.login_failed", target: email } });
          return null;
        }
        await clearFailures(email);
        return { id: user.id, name: user.name, email: user.email } as never;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = (user as { id: string }).id;
      return token;
    },
    // Role is NOT trusted from the token: it is re-read from the DB on every session lookup (QA BUG-013).
    async session({ session, token }) {
      const u = token.id ? await db.user.findUnique({ where: { id: token.id as string }, select: { id: true, role: true, name: true, email: true } }) : null;
      if (!u || u.role === "deleted") return { ...session, user: undefined as never };
      session.user.id = u.id; session.user.role = u.role; session.user.name = u.name; session.user.email = u.email;
      return session;
    },
  },
});

/** Server-side admin check against the current DB role. */
export async function currentAdmin() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const u = await db.user.findUnique({ where: { id: s.user.id } });
  return u?.role === "admin" ? u : null;
}
