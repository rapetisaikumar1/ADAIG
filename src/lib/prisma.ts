import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { serverEnv } from "./env";
/**
 * Prisma 7 client on the `pg` driver adapter (no Rust query engine). Relative imports so the seed and scripts (tsx) can use it.
 *
 * Connection string handling, so the URLs from Supabase/Vercel work unchanged:
 * - Prisma-only parameters (pgbouncer, connection_limit, pool_timeout, schema, …) are removed before they reach `pg`.
 *   Statements are unnamed (no statementNameGenerator), so the transaction pooler (Supavisor :6543) is safe.
 * - `sslmode` follows libpq semantics (`uselibpqcompat`): require = encrypted without CA verification (as Prisma 6 did),
 *   verify-ca / verify-full = verified (optionally with sslrootcert). No sslmode (local Supabase) = no TLS.
 * - Small pool for serverless: DB_POOL_MAX, else the URL's connection_limit, else 5; idle connections close after 10 s.
 */
const PRISMA_ONLY_PARAMS = ["pgbouncer", "connection_limit", "pool_timeout", "schema", "statement_cache_size", "socket_timeout", "sslaccept"];

export function pgPoolConfig(url: string, maxOverride?: number): { pool: PoolConfig; schema?: string } {
  const u = new URL(url);
  const p = u.searchParams;
  const schema = p.get("schema") || undefined;
  const limit = Number(p.get("connection_limit"));
  for (const k of PRISMA_ONLY_PARAMS) p.delete(k);
  if (p.has("sslmode") && !p.has("uselibpqcompat")) p.set("uselibpqcompat", "true");
  const max = maxOverride ?? (Number.isInteger(limit) && limit > 0 ? limit : 5);
  return { pool: { connectionString: u.toString(), max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 }, schema };
}

export function createPrismaClient(url: string) {
  const { pool, schema } = pgPoolConfig(url, serverEnv().DB_POOL_MAX);
  const adapter = new PrismaPg(pool, {
    schema,
    onPoolError: (err) => console.error("[db] idle connection error:", err.message),
  });
  return new PrismaClient({ adapter });
}
export type { PrismaClient };
