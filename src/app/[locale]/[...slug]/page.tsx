import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";

// Public content pages ported 1:1 from the design prototype (content managed as HTML until a CMS is chosen).
const PUBLIC = ["about", "principles", "governance", "community", "chapters", "resources", "news", "advocacy", "careers", "vendors", "legal"];
// Internal design-system reference pages: staff (admin) only.
const DESIGN: Record<string, string> = { "design/brand": "brand", "design/components": "components" };
// Chrome labels that also appear in content breadcrumbs/eyebrows; translated on untranslated (fallback) pages.
const CHROME_LABELS = ["about", "membership", "events", "resources", "community", "advocacy", "chapters", "careers", "contact", "aboutAdaig"] as const;

export const dynamic = "force-dynamic";

export default async function ContentPage({ params }: { params: Promise<{ locale: string; slug: string[] }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const key = slug.join("/");
  const file = PUBLIC.includes(key) ? key : DESIGN[key];
  if (!file) notFound();
  if (DESIGN[key]) {
    const s = await auth();
    if (s?.user?.role !== "admin") redirect(`/${locale}`);
  }
  const c = loadContent(file, locale); if (!c) notFound();
  const html = c.fallback ? await withFallbackChrome(c.html) : c.html;
  return (
    <main id="main">
      <Html html={html} />
    </main>
  );
}

/** Untranslated page: notice at the very top (before the hero) and breadcrumb/eyebrow chrome in the visitor's language. */
async function withFallbackChrome(html: string) {
  const t = await getTranslations("chrome");
  const en = await getTranslations({ locale: "en", namespace: "chrome" });
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const map = new Map<string, string>([["Home", t("crumbHome")], ...CHROME_LABELS.map((k) => [esc(en(k)), t(k)] as [string, string])]);
  // Breadcrumb links (the current-page crumb is the page title and stays with the English content).
  let out = html.replace(/<nav class="crumbs"[\s\S]*?<\/nav>/, (nav) => nav.replace(/(<a [^>]*>)([^<]+)(<\/a>)/g, (m, a, label, z) => (map.has(label) ? a + esc(map.get(label)!) + z : m)));
  // Hero eyebrow, when it is a section name.
  out = out.replace(/(<section class="page-hero[^"]*"(?:(?!<\/section>)[\s\S])*?<span class="eyebrow">)([^<]+)(<\/span>)/, (m, a, label, z) => (map.has(label) ? a + esc(map.get(label)!) + z : m));
  const icon = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6.2v.1" stroke-linecap="round"/></svg>`;
  const notice = `<div class="fallback-bar" role="note"><div class="container">${icon}<span>${esc(t("frPending"))}</span></div></div>`;
  return notice + out;
}
