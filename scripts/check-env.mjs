// First step of `vercel-build`: fail the deployment early with a clear message when required variables are missing,
// instead of a failed migration or a runtime error. (Runtime validation: src/lib/env.ts.)
const has = (k) => !!process.env[k]?.trim();
const pooled = ["DATABASE_URL", "POSTGRES_PRISMA_URL"].find(has);
const direct = ["DIRECT_URL", "POSTGRES_URL_NON_POOLING"].find(has);
const problems = [];
if (!has("AUTH_SECRET")) problems.push("AUTH_SECRET is missing (generate one with: openssl rand -base64 32).");
else if (process.env.NODE_ENV === "production" || has("VERCEL_ENV")) { // same rule as src/lib/env.ts (weakAuthSecret): at least 32 characters, not a placeholder
  const v = process.env.AUTH_SECRET.trim();
  if (v.length < 32 || /changeme|replaceme|yoursecret|supersecret|placeholder|example|generatewith|opensslrand|npxauthsecret/.test(v.toLowerCase().replace(/[^a-z0-9]/g, "")) || /^(.)\1+$/.test(v))
    problems.push("AUTH_SECRET is too weak: use at least 32 random characters, not a placeholder (generate one with: openssl rand -base64 32).");
}
if (!pooled) problems.push("DATABASE_URL (or POSTGRES_PRISMA_URL from the Supabase–Vercel integration) is missing.");
for (const k of [pooled, direct].filter(Boolean))
  if (!/^postgres(ql)?:\/\//i.test(process.env[k].trim())) problems.push(`${k} must be a postgres:// or postgresql:// URL (SQLite is no longer supported).`);
if (pooled && !direct && /:6543\b|pgbouncer=true/.test(process.env[pooled]))
  problems.push(`${pooled} is the transaction pooler; also set DIRECT_URL (or POSTGRES_URL_NON_POOLING) to the direct/session URL so migrations can run.`);
if (problems.length) {
  console.error(`\n[check-env] Cannot build:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
    "Set them in Vercel → Project → Settings → Environment Variables (see README → Deploying to Vercel), then redeploy.\n");
  process.exit(1);
}
console.log(`[check-env] OK (runtime: ${pooled}, migrations: ${direct ?? pooled}).`);
