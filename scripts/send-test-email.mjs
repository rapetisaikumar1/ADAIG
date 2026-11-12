// Send ONE branded test email through the configured SMTP server (Zoho in production) and print the server's answer.
// Usage:  npm run email:test -- you@example.com
// Reads SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL, NEXT_PUBLIC_SITE_URL
// from the environment, plus ./.env when present (variables already set in the environment win). Never prints the password.
// Uses the app's own email code (src/lib/email: same transport, timeouts and layout), but writes NO EmailLog row (no database).
// Runs through tsx (npm script) because it imports the TypeScript sources.
import { emailConfig, cleanAddress, siteUrl } from "../src/lib/email/config.ts";
import { renderEmail } from "../src/lib/email/layout.ts";
import { deliver, verifyTransport } from "../src/lib/email/transport.ts";

try { process.loadEnvFile(); console.log("[email:test] loaded .env (environment variables take precedence)"); } catch { /* no .env file */ }

const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
const to = cleanAddress(arg);
if (!to) {
  console.error(`Usage: npm run email:test -- you@example.com${arg ? `\n"${arg}" is not a valid email address.` : ""}`);
  process.exit(2);
}

const c = emailConfig();
console.log("[email:test] configuration (no secrets):");
console.log(`  SMTP server   ${c.host ?? "(SMTP_HOST not set)"}${c.port ? `:${c.port}` : ""}${c.secure === undefined ? "" : c.secure ? " (SSL/TLS)" : " (STARTTLS if offered; required for non-local hosts)"}`);
console.log(`  login         ${c.auth ? "SMTP_USER + SMTP_PASSWORD set" : "none"}`);
console.log(`  From          ${c.from ?? "(CONTACT_FROM_EMAIL not set)"}`);
console.log(`  inbox         ${c.contactTo ?? "(CONTACT_TO_EMAIL not set or invalid)"}`);
console.log(`  site URL      ${c.siteUrl}  (logo: ${siteUrl("/assets/email-logo.png")})`);
if (!c.configured) {
  console.error(`\n[email:test] Not sent: ${c.problem ?? "SMTP_HOST is not set"}. Set the variables (README → Email (SMTP)) and try again.`);
  process.exit(1);
}

console.log("\n[email:test] connecting and logging in…");
const v = await verifyTransport();
if (!v.ok) {
  console.error(`[email:test] FAILED to connect/log in: ${v.error}`);
  console.error("  Check SMTP_HOST/SMTP_PORT/SMTP_SECURE, and SMTP_USER/SMTP_PASSWORD (Zoho: an app-specific password if 2FA is on).");
  process.exit(1);
}
console.log("[email:test] connection and login OK; sending…");

const sentAt = new Date().toISOString();
const { html, text } = renderEmail({
  preheader: "Test message from the ADAIG website",
  heading: "Email is working",
  paragraphs: [
    "This is a test message sent from the ADAIG website with the configured SMTP settings.",
    "If you can read this, the website can send email: contact form notifications, membership emails and password reset links will be delivered the same way.",
  ],
  facts: [
    { label: "Sent at (UTC)", value: sentAt },
    { label: "SMTP server", value: `${c.host}:${c.port}` },
    { label: "From", value: c.from ?? "" },
  ],
  cta: { label: "Open the website", url: siteUrl("/en") },
  footerNote: "You received this email because someone ran the ADAIG email test (npm run email:test) with your address.",
});
const r = await deliver({ to, subject: "ADAIG email test", html, text, replyTo: c.contactTo ?? undefined });
if (r.ok) {
  console.log(`[email:test] SENT to ${to} (attempts: ${r.attempts})`);
  console.log(`  server response  ${r.response || "(none)"}`);
  console.log(`  message id       ${r.messageId ?? "(none)"}`);
  console.log("  Check the inbox (and the spam folder) of that address.");
  process.exit(0);
}
console.error(`[email:test] FAILED (attempts: ${r.attempts}, ${r.permanent ? "permanent" : "temporary"}): ${r.error}`);
process.exit(1);
