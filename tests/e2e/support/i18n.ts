/**
 * UI strings straight from the app's message catalogs, so assertions follow copy changes instead of hard-coding them.
 * Supports simple `{name}` placeholders (not ICU plurals: assert those with a regex instead).
 */
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

type Catalog = Record<string, unknown>;
const catalogs: Record<"en" | "fr", Catalog> = { en, fr };

export function msg(key: string, vars: Record<string, string | number> = {}, locale: "en" | "fr" = "en"): string {
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Catalog)[k] : undefined), catalogs[locale]);
  if (typeof v !== "string") throw new Error(`[e2e] missing message ${locale}:${key}`);
  return v.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
export const t = (key: string, vars?: Record<string, string | number>) => msg(key, vars, "en");
export const tFr = (key: string, vars?: Record<string, string | number>) => msg(key, vars, "fr");
/** Escape text for use inside a RegExp. */
export const re = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
