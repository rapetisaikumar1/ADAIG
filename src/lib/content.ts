import fs from "node:fs";
import path from "node:path";
/** Loads prototype page content (extracted by scripts/extract-design.py). FR falls back to EN until translated. */
export function loadContent(slug: string, locale: string): { html: string; fallback: boolean } | null {
  const dir = path.join(process.cwd(), "src/content");
  for (const [loc, fb] of [[locale, false], ["en", locale !== "en"]] as const) {
    const f = path.join(dir, loc, `${slug}.html`);
    if (fs.existsSync(f)) return { html: fs.readFileSync(f, "utf8").replaceAll("__L__", `/${locale}`), fallback: fb };
  }
  return null;
}
