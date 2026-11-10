/**
 * Test environment: base URL, database URL, browser launch options and the app's .env values (read only so the
 * "no secrets on the System page" test can compare against them). Nothing here is ever printed.
 */
import fs from "node:fs";
import path from "node:path";
import type { LaunchOptions } from "@playwright/test";

export const APP_DIR = path.resolve(__dirname, "../../..");
/** Run state (DB snapshot, signed-in sessions, cleanup report). Gitignored. */
export const STATE_DIR = path.join(APP_DIR, "tests/.state");
export const SNAPSHOT_FILE = path.join(STATE_DIR, "db-snapshot.json");
export const REPORT_FILE = path.join(STATE_DIR, "db-report.json");
export const authFile = (role: string) => path.join(STATE_DIR, "auth", `${role}.json`);

export const BASE_URL = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

/** Minimal .env parser (KEY=value, optional quotes, # comments). The app's own .env, not process.env. */
export function appDotEnv(): Record<string, string> {
  const file = path.join(APP_DIR, ".env");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/** Database the tests inspect and clean up: E2E_DATABASE_URL, else the app's DIRECT_URL / DATABASE_URL. */
export function databaseUrl(): string {
  const env = appDotEnv();
  const url = process.env.E2E_DATABASE_URL || process.env.DIRECT_URL || env.DIRECT_URL || process.env.DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error("[e2e] No database URL: set E2E_DATABASE_URL (or DIRECT_URL/DATABASE_URL in .env).");
  return url;
}

/**
 * Browser: PW_CHROME_PATH (a local Chrome/Chromium binary) or PW_CHANNEL (e.g. "chrome") when set,
 * otherwise Playwright's bundled Chromium (`npx playwright install chromium`, used in CI).
 */
export function browserOptions(): { channel?: string; launchOptions?: LaunchOptions } {
  const executablePath = process.env.PW_CHROME_PATH?.trim();
  const channel = process.env.PW_CHANNEL?.trim();
  return { ...(channel ? { channel } : {}), ...(executablePath ? { launchOptions: { executablePath } } : {}) };
}

/** Seed accounts (prisma/seed.ts). Their password can be overridden for a database seeded with SEED_PASSWORD. */
export const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD || "Password123!";
export const SEED = {
  admin: "admin@adaig.test",
  admin2: "admin2@adaig.test",
  member: "member@adaig.test",
  guest: "guest@adaig.test",
} as const;
export type Role = "admin" | "member" | "guest";
