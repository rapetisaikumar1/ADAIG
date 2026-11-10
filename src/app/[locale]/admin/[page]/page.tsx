import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { loadContent } from "@/lib/content";
import { AdminNav } from "@/components/AppShell";
import { Html } from "@/components/SiteChrome";
export const dynamic = "force-dynamic";
// Planned staff tools: static previews with sample data (no data is read, saved or sent; their controls are disabled).
const PAGES: Record<string, string> = { corporate: "corporate-admin", chapter: "chapter-leader" };
export default async function AdminPreview({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page } = await params; setRequestLocale(locale);
  if (!PAGES[page]) notFound();
  await requireAdmin(locale); const t = await getTranslations("admin");
  const c = (await loadContent(PAGES[page], locale))!;
  return (
    <div className="app adm"><AdminNav locale={locale} current={`/admin/${page}`} />
      <main id="main" className="app-main adm-preview">
        <div className="alert alert-info" role="note" style={{ marginBottom: 24 }}><div><b>{t("protoTitle")}</b>{t("protoBody")}{c.fallback ? ` ${t("protoEnOnly")}` : ""}</div></div>
        <div lang={c.fallback ? "en" : undefined}><Html html={c.html} /></div>
      </main>
    </div>
  );
}
