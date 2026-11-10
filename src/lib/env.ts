import { z } from "zod";
/**
 * Server-side environment, validated with zod on first use (never at import time, never sent to the browser:
 * only import this from server code — db, auth, payments, route handlers, scripts).
 *
 * Database (Supabase Postgres). Two connections:
 * - runtime (the app): the POOLED URL — Supavisor transaction mode, port 6543, `?pgbouncer=true`.
 *     DATABASE_URL, or POSTGRES_PRISMA_URL (set by the Supabase–Vercel integration).
 * - CLI / migrations / seed: the DIRECT or session URL.
 *     DIRECT_URL, or POSTGRES_URL_NON_POOLING (integration). Falls back to the runtime URL (local development: one URL).
 * Feature flags (payments, throttling, policies) are optional and keep their existing parsing where they are used.
 */
const opt = z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined));
const pgUrl = opt.refine((v) => v === undefined || /^postgres(ql)?:\/\//i.test(v), "must be a postgres:// or postgresql:// connection string");

/** Production AUTH_SECRET rules (same as scripts/check-env.mjs): at least 32 characters and not a known placeholder. */
export const AUTH_SECRET_MIN = 32;
const PLACEHOLDER = /changeme|replaceme|yoursecret|supersecret|placeholder|example|generatewith|opensslrand|npxauthsecret/;
/** Weak = shorter than 32, contains a placeholder phrase (case, spaces and punctuation ignored), or one repeated character. */
export const weakAuthSecret = (v: string) =>
  v.length < AUTH_SECRET_MIN || PLACEHOLDER.test(v.toLowerCase().replace(/[^a-z0-9]/g, "")) || /^(.)\1+$/.test(v);

const schema = z.object({
  NODE_ENV: opt,
  AUTH_SECRET: opt,
  DATABASE_URL: pgUrl,
  POSTGRES_PRISMA_URL: pgUrl,
  DIRECT_URL: pgUrl,
  POSTGRES_URL_NON_POOLING: pgUrl,
  DB_POOL_MAX: opt.refine((v) => v === undefined || (/^\d+$/.test(v) && +v >= 1 && +v <= 50), "must be a whole number from 1 to 50")
    .transform((v) => (v ? Number(v) : undefined)),
  STRIPE_SECRET_KEY: opt,
  STRIPE_WEBHOOK_SECRET: opt,
  APP_URL: opt,
  APP_ENV: opt,
  ALLOW_MOCK_PAYMENTS: opt,
  /** Bearer token for /api/cron/* (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Unset → the cron routes answer 503. */
  CRON_SECRET: opt,
  VERCEL_ENV: opt,
}).superRefine((e, ctx) => {
  const prod = e.NODE_ENV === "production" || !!e.VERCEL_ENV;
  if (prod && !e.AUTH_SECRET)
    ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "is required in production (generate one with: openssl rand -base64 32)" });
  else if (prod && weakAuthSecret(e.AUTH_SECRET!))
    ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: `is too weak for production: use at least ${AUTH_SECRET_MIN} random characters, not a placeholder (generate one with: openssl rand -base64 32)` });
});

export type ServerEnv = z.infer<typeof schema>;
let cached: ServerEnv | undefined;

/** Validated server environment. Throws one readable error listing every problem. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const r = schema.safeParse(process.env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`[env] Invalid server environment:\n${lines.join("\n")}\nSet the variables in .env (local) or in Vercel → Project → Settings → Environment Variables.`);
  }
  return (cached = r.data);
}

const missingDb = (which: string) =>
  new Error(`[env] No database URL: set ${which}. Local: the Supabase CLI URL (see .env.example); Vercel: connect Supabase under Storage, or set the variables by hand.`);

/** Pooled connection used by the running app. */
export function runtimeDatabaseUrl(e = serverEnv()): string {
  const url = e.DATABASE_URL ?? e.POSTGRES_PRISMA_URL;
  if (!url) throw missingDb("DATABASE_URL (or POSTGRES_PRISMA_URL from the Supabase–Vercel integration)");
  return url;
}
/** Direct / session connection used by migrations, the seed and maintenance scripts (falls back to the runtime URL). */
export function directDatabaseUrl(e = serverEnv()): string {
  const url = e.DIRECT_URL ?? e.POSTGRES_URL_NON_POOLING ?? e.DATABASE_URL ?? e.POSTGRES_PRISMA_URL;
  if (!url) throw missingDb("DIRECT_URL or DATABASE_URL (or POSTGRES_URL_NON_POOLING / POSTGRES_PRISMA_URL)");
  return url;
}
