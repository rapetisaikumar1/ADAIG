// Runbook (BUG-031): unlock an account from the CLI without wiping data.  Usage: npm run unlock -- user@example.com
import { scriptDb } from "./lib/script-db";
const { db } = scriptDb();
const email = (process.argv[2] ?? "").toLowerCase().trim();
if (!email) { console.error("Usage: npm run unlock -- <email>"); process.exit(1); }
db.loginThrottle.deleteMany({ where: { key: `e:${email}` } })
  .then(async (r) => { await db.auditLog.create({ data: { actor: "cli", action: "auth.account_unlocked", target: email } }); console.log(`Cleared ${r.count} lock row(s) for ${email}`); })
  .finally(() => db.$disconnect());
