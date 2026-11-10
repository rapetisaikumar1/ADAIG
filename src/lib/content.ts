import fs from "node:fs";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

/**
 * Page content. Default = the HTML files in src/content/<locale>/ (originally extracted from the prototype, edited since;
 * FR falls back to EN until translated). Staff can override a page per locale in Admin → Content (ContentPage rows, with revisions); an override
 * wins over the file. With no ContentPage rows every page renders exactly the file content. `__L__` = locale URL prefix.
 */

/** Cache tag for overrides; the admin content actions call updateTag(CONTENT_TAG) after every change. */
export const CONTENT_TAG = "content-pages";
/** Safety net: cached overrides also expire after 5 minutes (changes made outside Admin → Content: seed, SQL, restored backup). */
const CONTENT_REVALIDATE_S = 300;
export const CONTENT_LOCALES = ["en", "fr"] as const;

/** Pages editable in Admin → Content. kind: "page" = whole page body; "part" = the HTML part of a page whose other
 *  sections are built by the app (home: live events list; membership: tier cards; contact: form); "staff" = admin-only page. */
export const EDITABLE_CONTENT = [
  { slug: "home", path: "", kind: "part" },
  { slug: "about", path: "/about", kind: "page" },
  { slug: "principles", path: "/principles", kind: "page" },
  { slug: "governance", path: "/governance", kind: "page" },
  { slug: "membership", path: "/membership", kind: "part" },
  { slug: "community", path: "/community", kind: "page" },
  { slug: "chapters", path: "/chapters", kind: "page" },
  { slug: "resources", path: "/resources", kind: "page" },
  { slug: "news", path: "/news", kind: "page" },
  { slug: "advocacy", path: "/advocacy", kind: "page" },
  { slug: "careers", path: "/careers", kind: "page" },
  { slug: "vendors", path: "/vendors", kind: "page" },
  { slug: "legal", path: "/legal", kind: "page" },
  { slug: "contact", path: "/contact", kind: "part" },
  { slug: "brand", path: "/design/brand", kind: "staff" },
  { slug: "components", path: "/design/components", kind: "staff" },
] as const satisfies readonly { slug: string; path: string; kind: "page" | "part" | "staff" }[];
export const editableContent = (slug: string) => EDITABLE_CONTENT.find((p) => p.slug === slug);

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
