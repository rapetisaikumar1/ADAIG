import fs from "node:fs";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

/**
 * Page content. Default = the HTML files in src/content/<locale>/ (originally extracted from the prototype, edited since;
 * FR falls back to EN until translated). A ContentPage row (one per page and locale, with revisions) overrides the file: rows
 * saved by the former Admin → Content module (removed in round 7; there is no editing UI any more) are still rendered.
 * With no ContentPage rows every page renders exactly the file content. `__L__` = locale URL prefix.
 */

/** Cache tag for overrides (no code changes them any more; a future CMS would call updateTag(CONTENT_TAG) after each save). */
export const CONTENT_TAG = "content-pages";
/** Safety net: cached overrides also expire after 5 minutes (changes made directly in the DB: SQL, seed, restored backup). */
const CONTENT_REVALIDATE_S = 300;
export const CONTENT_LOCALES = ["en", "fr"] as const;

/** Raw file content (with `__L__`) for exactly this locale, or null. Slugs are looked up in a fixed folder only. */
export function fileContent(slug: string, locale: string): string | null {
  if (!/^[a-z0-9-]+$/.test(slug) || !(CONTENT_LOCALES as readonly string[]).includes(locale)) return null;
  const f = path.join(process.cwd(), "src/content", locale, `${slug}.html`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}

const cachedOverride = (slug: string, locale: string) =>
  unstable_cache(
    async () => (await db.contentPage.findUnique({ where: { slug_locale: { slug, locale } }, select: { html: true } }))?.html ?? null,
    ["content-page", slug, locale],
    { tags: [CONTENT_TAG], revalidate: CONTENT_REVALIDATE_S },
  )();

/** Staff override (raw, with `__L__`) or null. If the database is unreachable the page falls back to the file content. */
export async function contentOverride(slug: string, locale: string): Promise<string | null> {
  try {
    return await cachedOverride(slug, locale);
  } catch (e) {
    console.error(`[content] override lookup failed for ${locale}/${slug}; using the file`, e);
    return null;
  }
}

/** Page content for a locale: override → file, then the English override → file (fallback: true). */
export async function loadContent(slug: string, locale: string): Promise<{ html: string; fallback: boolean } | null> {
  for (const [loc, fb] of [[locale, false], ["en", locale !== "en"]] as const) {
    const html = (await contentOverride(slug, loc)) ?? fileContent(slug, loc);
    if (html !== null) return { html: html.replaceAll("__L__", `/${locale}`), fallback: fb };
  }
  return null;
}
