// Picks the Prisma datasource provider from DATABASE_URL so the same schema works locally and on Vercel:
//   file:./dev.db            → sqlite      (local development, the committed default)
//   postgres(ql)://…         → postgresql  (Vercel / any hosted Postgres, e.g. Neon)
// Connection variables (first one set wins):
//   pooled  : DATABASE_URL, POSTGRES_PRISMA_URL (Supabase/Vercel integration), POSTGRES_URL
//   direct  : DATABASE_URL_UNPOOLED (Neon), DIRECT_URL, POSTGRES_URL_NON_POOLING (Supabase) → `directUrl`, used for schema pushes
// Runs before `prisma generate` (postinstall) and in `vercel-build`. Without DATABASE_URL it leaves the schema unchanged.
// With --require it fails loudly when DATABASE_URL / AUTH_SECRET are missing (used on Vercel builds).
import fs from "node:fs";

const file = new URL("../prisma/schema.prisma", import.meta.url);
const URL_VARS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"];
const DIRECT_VARS = ["DATABASE_URL_UNPOOLED", "DIRECT_URL", "POSTGRES_URL_NON_POOLING"];
const urlVar = URL_VARS.find((k) => process.env[k]);
const url = urlVar ? process.env[urlVar] : "";
const require = process.argv.includes("--require");

if (require) {
  const missing = [...(urlVar ? [] : ["DATABASE_URL (or POSTGRES_PRISMA_URL)"]), ...(process.env.AUTH_SECRET ? [] : ["AUTH_SECRET"])];
  if (missing.length) {
    console.error(`\n[prisma-provider] Missing environment variable(s): ${missing.join(", ")}.\n` +
      "Set them in Vercel → Project → Settings → Environment Variables (see README → Deploying to Vercel), then redeploy.\n");
    process.exit(1);
  }
  if (url.startsWith("file:")) {
    console.error("\n[prisma-provider] DATABASE_URL points to a SQLite file. Vercel's file system is read-only and temporary, so use a hosted Postgres database (e.g. Neon) instead.\n");
    process.exit(1);
  }
}
if (!url) process.exit(0);

const provider = /^postgres(ql)?:\/\//.test(url) ? "postgresql" : url.startsWith("file:") ? "sqlite" : null;
if (!provider) { console.error("[prisma-provider] Unrecognized DATABASE_URL scheme; leaving schema unchanged."); process.exit(0); }

const direct = provider === "postgresql" ? DIRECT_VARS.find((k) => process.env[k]) ?? null : null;
const src = fs.readFileSync(file, "utf8");
const block = `datasource db {\n  provider = "${provider}"\n  url      = env("${urlVar}")\n${direct ? `  directUrl = env("${direct}")\n` : ""}}`;
const next = src.replace(/datasource db \{[\s\S]*?\n\}/, block);
if (next !== src) { fs.writeFileSync(file, next); console.log(`[prisma-provider] datasource: ${provider}, url ${urlVar}${direct ? `, directUrl ${direct}` : ""}`); }
