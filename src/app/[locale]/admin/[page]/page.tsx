import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPermission } from "@/lib/rbac";
import { loadContent } from "@/lib/content";
import { AdminNav } from "@/components/AppShell";
import { Html } from "@/components/SiteChrome";
import { Icon } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
// Planned staff tools: static previews with sample data (no data is read, saved or sent; their controls are disabled).
const PAGES: Record<string, string> = { corporate: "corporate-admin", chapter: "chapter-leader" };
export default async function AdminPreview({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page } = await params; setRequestLocale(locale);
  if (!PAGES[page]) notFound();
  await requireAdminPermission(locale, "system", "view"); const t = await getTranslations("admin");
  const c = (await loadContent(PAGES[page], locale))!;
  return (
    // Previews are reached only from the Overview page (/admin/dashboard, itself not in the admin menu): no menu item is
    // highlighted, and the back link returns to Overview.
    <div className="app adm"><AdminNav locale={locale} current="/admin/dashboard" />
      <main id="main" tabIndex={-1} className="app-main adm-preview">
        <a className="adm-back" href={`/${locale}/admin/dashboard`}><Icon name="arrow-left" size={16} />{t("backOverview")}</a>
        <div className="alert alert-info" role="note"><div><b>{t("protoTitle")}</b>{t("protoBody")}{c.fallback ? ` ${t("protoEnOnly")}` : ""}</div></div>
        <div lang={c.fallback ? "en" : undefined}><Html html={c.html} /></div>
      </main>
    </div>
  );
}
