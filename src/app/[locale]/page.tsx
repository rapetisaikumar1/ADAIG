import { setRequestLocale } from "next-intl/server";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const c = loadContent("home", locale)!;
  return <main id="main"><Html html={c.html} /></main>;
}
