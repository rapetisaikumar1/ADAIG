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
// Email link origin (round-8 SEC M2): every email link (password reset links carry live tokens) and the email logo use
// NEXT_PUBLIC_SITE_URL, so a wrong domain or plain http FAILS the build. Only the host is compared with APP_URL (APP_URL's
// scheme may be http; it is not checked here). Runtime: src/lib/email/config.ts siteUrl() also upgrades http to https in production.
if (has("NEXT_PUBLIC_SITE_URL")) {
  const parse = (v) => { try { const u = new URL(v.trim()); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
  const site = parse(process.env.NEXT_PUBLIC_SITE_URL);
  if (!site) problems.push("NEXT_PUBLIC_SITE_URL is not a valid URL: use the public site's address, e.g. https://your-domain (it is the origin of every link in emails).");
  else {
    if (site.protocol !== "https:") problems.push(`NEXT_PUBLIC_SITE_URL must start with https:// (got ${site.origin}): it is the origin of every link in emails, including password reset links.`);
    const app = has("APP_URL") ? parse(process.env.APP_URL) : null;
    if (app && app.hostname.toLowerCase() !== site.hostname.toLowerCase())
      problems.push(`NEXT_PUBLIC_SITE_URL's host "${site.hostname}" differs from APP_URL's host "${app.hostname}": email links (including password reset links) would point to another site. Check the spelling of the domain and set both to the same site.`);
  }
}
if (problems.length) {
  console.error(`\n[check-env] Cannot build:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
    "Set them in Vercel → Project → Settings → Environment Variables (see README → Deploying to Vercel), then redeploy.\n");
  process.exit(1);
}
// Email (round 8): WARN only, never fail the build. Without SMTP the site works, but emails are logged as "skipped".
if (process.env.NODE_ENV === "production" || has("VERCEL_ENV")) {
  const mail = [];
  if (!has("SMTP_HOST")) mail.push("SMTP_HOST is not set: NO emails will be sent (contact form, membership, password reset); they are logged as skipped.");
  else {
    if (has("SMTP_USER") !== has("SMTP_PASSWORD")) mail.push("set both SMTP_USER and SMTP_PASSWORD (or neither): emails will fail until then.");
    else if (!has("SMTP_USER") && !/^(localhost|127\.0\.0\.1|::1)$/i.test(process.env.SMTP_HOST.trim())) mail.push("SMTP_USER / SMTP_PASSWORD are not set: most SMTP servers (Zoho too) require a login.");
    if (has("SMTP_PORT") && !/^\d{1,5}$/.test(process.env.SMTP_PORT.trim())) mail.push("SMTP_PORT is not a number.");
    if (!has("CONTACT_FROM_EMAIL") && !/@/.test(process.env.SMTP_USER ?? "")) mail.push("CONTACT_FROM_EMAIL is not set: emails cannot be sent without a From address.");
  }
  if (!has("CONTACT_TO_EMAIL")) mail.push("CONTACT_TO_EMAIL is not set: contact-form and membership-application notifications have no inbox to go to.");
  if (!has("NEXT_PUBLIC_SITE_URL") && !has("APP_URL")) mail.push("NEXT_PUBLIC_SITE_URL (or APP_URL) is not set: links and the logo in emails would point to http://localhost:3000.");
  if (mail.length) console.warn(`\n[check-env] WARNING (email, build continues):\n${mail.map((p) => `  - ${p}`).join("\n")}\n` +
    "See README → Email (SMTP). Check delivery with: npm run email:test -- you@example.com\n");
}
console.log(`[check-env] OK (runtime: ${pooled}, migrations: ${direct ?? pooled}).`);
