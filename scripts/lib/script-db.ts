// Shared by the seed and the maintenance scripts (run with tsx). Loads .env when present (real environment variables win)
// and connects on the DIRECT / session URL (DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL → POSTGRES_PRISMA_URL).
import { createPrismaClient } from "../../src/lib/prisma";
import { directDatabaseUrl } from "../../src/lib/env";

export function scriptDb() {
  try { process.loadEnvFile(); } catch { /* no .env file: use the process environment */ }
  const url = directDatabaseUrl();
  return { db: createPrismaClient(url), url };
}

/** True for any database that is not on this machine (seed safety guards). */
export function isHostedDb(url: string) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ""); } catch { return true; }
  return !["localhost", "127.0.0.1", "::1"].includes(host);
}
