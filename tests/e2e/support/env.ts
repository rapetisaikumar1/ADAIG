/**
 * Test environment: base URL, database URL, browser launch options and the app's .env values (read only so the
 * "no secrets on the System page" test can compare against them). Nothing here is ever printed.
 */
import fs from "node:fs";
import path from "node:path";
import type { LaunchOptions } from "@playwright/test";
import { assertLocalDb, isLocalUrl, urlHost } from "../../../scripts/lib/db-guard";

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

/**
 * Database the tests inspect, write to and clean up (the suite DELETEs rows): E2E_DATABASE_URL only, never the app's .env
 * (which may hold production URLs). It must be a local database (localhost / 127.0.0.1 / ::1) unless ALLOW_REMOTE_DB=1.
 * Use the same database as the app under test, e.g. E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres.
 */
export function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL?.trim();
  if (!url) throw new Error("[e2e] Set E2E_DATABASE_URL to the (local) database of the app under test. The suite never falls back to .env, which may point at production.");
  assertLocalDb(url, "the e2e suite (it writes and deletes rows)");
  return url;
}

/**
 * Stricter guard for the pre-run purge of earlier runs' e2e leftovers (global setup): the E2E database must be on this
 * machine, with NO override (ALLOW_REMOTE_DB=1 does not apply). Returns the URL.
 */
export function strictlyLocalDatabaseUrl(): string {
  const url = databaseUrl();
  if (!isLocalUrl(url)) throw new Error(`[e2e] Refusing to purge e2e leftovers on the non-local database host "${urlHost(url) || "(unparsable URL)"}" (ALLOW_REMOTE_DB does not apply to the purge). Use a local E2E_DATABASE_URL.`);
  return url;
}

/**
 * Called by playwright.config.ts before anything runs: the app under test (E2E_BASE_URL) must be on this machine unless
 * E2E_ALLOW_REMOTE=1 (the tests create accounts, events and messages through the UI), and E2E_DATABASE_URL must be set and local.
 */
export function assertSafeTargets() {
  if (!isLocalUrl(BASE_URL) && process.env.E2E_ALLOW_REMOTE !== "1")
    throw new Error(`[e2e] Refusing to test the non-local app "${urlHost(BASE_URL) || BASE_URL}": the suite creates and deletes data. Use a local app, or set E2E_ALLOW_REMOTE=1 if you are sure.`);
  databaseUrl();
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
