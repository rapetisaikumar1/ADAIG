import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";

// Public content pages ported 1:1 from the design prototype (content managed as HTML until a CMS is chosen).
const PUBLIC = ["about", "governance", "certifications", "verify", "learning", "community", "chapters", "resources", "news", "advocacy", "careers", "vendors", "contact", "legal", "mfa"];
const DESIGN: Record<string, string> = { "design/brand": "brand", "design/components": "components" };

export const dynamic = "force-dynamic";

export default async function ContentPage({ params }: { params: Promise<{ locale: string; slug: string[] }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const key = slug.join("/");
  const file = PUBLIC.includes(key) ? key : DESIGN[key];
  if (!file) notFound();
  const c = loadContent(file, locale); if (!c) notFound();
  const t = await getTranslations("chrome");
  return (
    <main id="main" className={file === "mfa" ? "auth-wrap" : undefined}>
      {c.fallback && <div className="container" style={{ paddingTop: 12 }}><div className="alert alert-info" role="note"><div>{t("frPending")}</div></div></div>}
      <Html html={c.html} />
    </main>
  );
}
