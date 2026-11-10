// Safety guard for every tool that can delete or overwrite data (db:reset, db:migrate, the seed, the e2e setup/teardown/cleanup).
// app/.env may hold PRODUCTION URLs, and these tools would otherwise fall back to it. They refuse any database whose host is
// not this machine (localhost, 127.0.0.1, ::1) unless ALLOW_REMOTE_DB=1 is set for that one command.
// Plain TypeScript with no app imports, so the seed, the scripts (tsx) and the Playwright suite can all use it.

/** Env var that allows a destructive tool to run against a non-local database (one command at a time). */
export const REMOTE_DB_OVERRIDE = "ALLOW_REMOTE_DB";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/** Host name of a URL (IPv6 brackets removed), or "" when it can't be parsed. */
export function urlHost(url: string): string {
  try { return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase(); } catch { return ""; }
}
/** True only for a URL whose host is this machine. Unparsable URLs count as remote. */
export const isLocalUrl = (url: string) => LOCAL_HOSTS.includes(urlHost(url));
export const remoteDbAllowed = () => process.env[REMOTE_DB_OVERRIDE] === "1";

/** Same order as prisma.config.ts and src/lib/env.ts directDatabaseUrl(): the URL the CLI, seed and scripts connect to. */
export function cliDatabaseUrl(): string | undefined {
  return ["DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_PRISMA_URL"].map((k) => process.env[k]?.trim()).find(Boolean);
}

/**
 * Throws unless `url` points at a local database or ALLOW_REMOTE_DB=1 is set. `what` names the operation in the message.
 * The message names the host only (never the user, password or full URL).
 */
export function assertLocalDb(url: string | undefined, what: string): void {
  if (!url) throw new Error(`[db-guard] ${what}: no database URL is set.`);
  if (isLocalUrl(url) || remoteDbAllowed()) return;
  throw new Error(
    `[db-guard] Refusing to run ${what} against the non-local database host "${urlHost(url) || "(unparsable URL)"}". ` +
    `This command can delete data. Use a local database URL (e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres), ` +
    `or, only if you are sure, set ${REMOTE_DB_OVERRIDE}=1 for this one command.`,
  );
}
