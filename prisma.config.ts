// Prisma CLI configuration (Prisma 7: connection URLs no longer live in schema.prisma).
// The CLI (migrate, db execute, studio) uses the DIRECT / session connection, never the transaction pooler:
//   DIRECT_URL → POSTGRES_URL_NON_POOLING (Supabase–Vercel integration) → DATABASE_URL → POSTGRES_PRISMA_URL (last two: local dev,
//   where a single URL serves both). `prisma generate` needs no URL. The app itself connects through src/lib/db.ts (pooled URL).
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env by itself. Load it when present (real environment variables, e.g. on Vercel, take precedence).
try { process.loadEnvFile(); } catch { /* no .env file */ }

const pick = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: pick("DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_PRISMA_URL"),
  },
});
