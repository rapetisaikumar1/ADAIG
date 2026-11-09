import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { loadContent } from "@/lib/content";
import { MemberNav } from "@/components/AppShell";
import { Html } from "@/components/SiteChrome";
export const dynamic = "force-dynamic";
// Stubbed member pages: prototype layout with placeholder data, behind login.
const PAGES: Record<string, string> = { billing: "my-billing", credentials: "my-credentials", learning: "my-learning", events: "my-events", community: "my-community", directory: "directory" };
export default async function MyStub({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page } = await params; setRequestLocale(locale);
  if (!PAGES[page]) notFound();
  await requireUser(locale);
  const c = loadContent(PAGES[page], locale)!;
  return (
    <div className="app"><MemberNav locale={locale} current={`/my/${page}`} />
      <main id="main" className="app-main"><div className="alert alert-info" role="note" style={{ marginBottom: 16 }}><div><b>Prototype view</b>Placeholder data — this page is not yet wired to the database.</div></div><Html html={c.html} /></main>
    </div>
  );
}
