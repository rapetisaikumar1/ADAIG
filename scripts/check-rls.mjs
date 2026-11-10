// Supabase lockdown check: fails (exit 1) if any table in `public` lacks Row Level Security, or if the Data API roles
// (anon, authenticated) hold any privilege on a public table. Runs in `vercel-build` after `prisma migrate deploy`.
// Usage: npm run db:check-rls   (uses DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL → POSTGRES_PRISMA_URL)
import pg from "pg";

try { process.loadEnvFile(); } catch { /* no .env file */ }
const raw = ["DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_PRISMA_URL"].map((k) => process.env[k]?.trim()).find(Boolean);
if (!raw) { console.error("[check-rls] No database URL (DIRECT_URL or DATABASE_URL)."); process.exit(1); }
// Same URL handling as src/lib/prisma.ts: drop Prisma-only parameters, libpq sslmode semantics.
const u = new URL(raw);
for (const k of ["pgbouncer", "connection_limit", "pool_timeout", "schema", "statement_cache_size", "socket_timeout", "sslaccept"]) u.searchParams.delete(k);
if (u.searchParams.has("sslmode") && !u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");

const client = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 15000 });
await client.connect();
try {
  const { rows: tables } = await client.query(
    `SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`);
  const roles = (await client.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`)).rows.map((r) => r.rolname);
  const grants = roles.length ? (await client.query(
    `SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
     FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = ANY($1) GROUP BY 1, 2 ORDER BY 2, 1`, [roles])).rows : [];
  const noRls = tables.filter((t) => !t.rls);
  for (const t of tables) console.log(`${t.rls ? "ok  " : "FAIL"} RLS ${t.rls ? "enabled " : "DISABLED"} public."${t.name}"`);
  for (const g of grants) console.log(`FAIL ${g.grantee} has ${g.privs} on public."${g.table_name}"`);
  if (!tables.length) console.log("(no tables in public)");
  if (noRls.length || grants.length) {
    console.error(`\n[check-rls] ${noRls.length} table(s) without RLS, ${grants.length} Data API grant(s). Enable RLS / revoke grants in a migration ` +
      `(see prisma/migrations/*_supabase_rls_lockdown).`);
    process.exitCode = 1;
  } else console.log(`[check-rls] OK: ${tables.length} public table(s), all with RLS; anon/authenticated have no table privileges.`);
} finally {
  await client.end();
}
