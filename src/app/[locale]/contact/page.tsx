import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";
import { ContactForm } from "./ContactForm";
export const dynamic = "force-dynamic";

/** Contact & FAQ: a working contact form (messages go to Admin → Messages) beside the FAQ from src/content/<locale>/contact.html. */
export default async function Contact({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ topic?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const t = await getTranslations("contact"); const tc = await getTranslations("chrome");
  const { topic } = await searchParams;
  const s = await auth();
  const u = s?.user?.id ? await db.user.findUnique({ where: { id: s.user.id }, select: { name: true, email: true, organisation: true } }) : null;
  const faq = loadContent("contact", locale);
  return (
    <main id="main" className="contact-page">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{tc("crumbHome")}</a></li><li aria-current="page">{t("title")}</li></ol></nav>
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container contact-layout">
        <div className="card contact-card"><ContactForm locale={locale} initialTopic={topic} defaults={{ name: u?.name ?? undefined, email: u?.email ?? undefined, org: u?.organisation ?? undefined }} /></div>
        <div className="contact-side">
          {faq?.fallback && <p className="small muted">{tc("frPending")}</p>}
          {faq && <Html html={faq.html} />}
        </div>
      </div></section>
    </main>
  );
}
