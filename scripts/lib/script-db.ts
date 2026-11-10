// Shared by the seed and the maintenance scripts (run with tsx). Loads .env when present (real environment variables win)
// and connects on the DIRECT / session URL (DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL → POSTGRES_PRISMA_URL).
// The target host (never the credentials) is printed to stderr, so nobody runs a script against production by accident.
import { createPrismaClient } from "../../src/lib/prisma";
import { directDatabaseUrl } from "../../src/lib/env";
import { isLocalUrl, urlHost } from "./db-guard";

export function scriptDb() {
  try { process.loadEnvFile(); } catch { /* no .env file: use the process environment */ }
  const url = directDatabaseUrl();
  console.error(`[db] ${isLocalUrl(url) ? "local" : "REMOTE"} database host: ${urlHost(url) || "(unparsable URL)"}`);
  return { db: createPrismaClient(url), url };
}

/** True for any database that is not on this machine (seed safety guards). */
export const isHostedDb = (url: string) => !isLocalUrl(url);
