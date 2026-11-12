import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

/**
 * Self-service password reset (round 8, EMAIL_SPEC §3). The raw token exists only in memory and in the emailed link; the DB
 * stores its SHA-256 hash (PasswordResetToken.tokenHash), so a database leak gives no usable link. A token works once
 * (usedAt), for RESET_TTL_MIN minutes, and only for an active, not deleted account. A new request, a password change or reset,
 * a sign-in email change and an account deletion delete the user's earlier tokens.
 */
export const RESET_TTL_MIN = 60;
/** 32 random bytes, base64url without padding = 43 URL-safe characters. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh random token and its hash (store only the hash). */
export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/**
 * Read-only check (never consumes the token: mail scanners prefetch links). The token row when it is well-formed, unused, not
 * expired, and its account is active and not deleted; otherwise null.
 */
export async function findValidToken(token: string): Promise<{ id: string; user: { id: string; email: string; role: string; active: boolean } } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, usedAt: true, expiresAt: true, user: { select: { id: true, email: true, role: true, active: true } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.user.active || row.user.role === "deleted") return null;
  return { id: row.id, user: row.user };
}
