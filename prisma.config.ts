// Prisma CLI configuration (Prisma 7: connection URLs no longer live in schema.prisma).
// The CLI (migrate, db execute, studio) uses the DIRECT / session connection, never the transaction pooler:
//   DIRECT_URL → POSTGRES_URL_NON_POOLING (Supabase–Vercel integration) → DATABASE_URL → POSTGRES_PRISMA_URL (last two: local dev,
//   where a single URL serves both). `prisma generate` needs no URL. The app itself connects through src/lib/db.ts (pooled URL).
import { defineConfig } from "prisma/config";
import { assertLocalDb } from "./scripts/lib/db-guard";

// Prisma 7 no longer reads .env by itself. Load it when present (real environment variables, e.g. on Vercel, take precedence).
try { process.loadEnvFile(); } catch { /* no .env file */ }

const pick = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean);
const url = pick("DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_PRISMA_URL");

// Commands that can drop or rewrite data (`migrate reset`, `migrate dev`, `db push`) refuse a non-local database unless
// ALLOW_REMOTE_DB=1 (app/.env may hold production URLs). `migrate deploy` (Vercel build), `migrate status`, `generate` are unaffected.
const args = process.argv.slice(2);
const has = (...words: string[]) => words.every((w) => args.includes(w));
if (url && (has("migrate", "reset") || has("migrate", "dev") || has("db", "push"))) assertLocalDb(url, `prisma ${args.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ")}`);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url,
  },
});
