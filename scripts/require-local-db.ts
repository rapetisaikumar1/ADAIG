// Runs before the destructive npm scripts (db:reset, db:migrate): exits 1 unless the database the Prisma CLI would use
// (DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL → POSTGRES_PRISMA_URL, .env loaded like prisma.config.ts) is on this
// machine, or ALLOW_REMOTE_DB=1 is set. Usage: tsx scripts/require-local-db.ts <operation name>
import { assertLocalDb, cliDatabaseUrl } from "./lib/db-guard";

try { process.loadEnvFile(); } catch { /* no .env file: use the process environment */ }
try {
  assertLocalDb(cliDatabaseUrl(), process.argv[2] || "this command");
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
