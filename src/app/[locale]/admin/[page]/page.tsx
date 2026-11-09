import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { loadContent } from "@/lib/content";
import { AdminNav } from "@/components/AppShell";
import { Html } from "@/components/SiteChrome";
export const dynamic = "force-dynamic";
const PAGES: Record<string, string> = { content: "admin-content", credentialing: "admin-credentialing", corporate: "corporate-admin", chapter: "chapter-leader" };
export default async function AdminStub({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page } = await params; setRequestLocale(locale);
  if (!PAGES[page]) notFound();
  await requireAdmin(locale);
  const c = loadContent(PAGES[page], locale)!;
  return (
    <div className="app"><AdminNav locale={locale} current={`/admin/${page}`} />
      <main id="main" className="app-main"><div className="alert alert-info" role="note" style={{ marginBottom: 16 }}><div><b>Prototype view</b>Placeholder data — not yet wired (Phase 2).</div></div><Html html={c.html} /></main>
    </div>
  );
}
