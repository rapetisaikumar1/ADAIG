import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { loadContent } from "@/lib/content";
import { Html } from "@/components/SiteChrome";
import { ContactForm } from "./ContactForm";
import { SiteContactInfo } from "@/components/SiteContactInfo";
import { Icon } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";

/** Contact & FAQ: a working contact form (messages go to Admin → Messages) beside the FAQ from src/content/<locale>/contact.html. */
export default async function Contact({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ topic?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const t = await getTranslations("contact"); const tc = await getTranslations("chrome");
  const { topic } = await searchParams;
  const s = await auth();
  const u = s?.user?.id ? await db.user.findUnique({ where: { id: s.user.id }, select: { name: true, email: true, organisation: true } }) : null;
  const faq = await loadContent("contact", locale);
  // contact.html = route cards, then <!--FAQ--> and the FAQ. The FAQ gets its own band below the form; without the marker
  // (e.g. an older Admin → Content edit) everything stays in the side column as before.
  const [sideHtml, faqHtml] = faq ? (faq.html.includes("<!--FAQ-->") ? faq.html.split("<!--FAQ-->", 2) : [faq.html, ""]) : ["", ""];
  // English fallback content keeps lang="en" so screen readers pronounce it correctly on /fr.
  const part = (html: string) => (faq?.fallback ? <div lang="en" style={{ display: "contents" }}><Html html={html} /></div> : <Html html={html} />);
  return (
    <main id="main" tabIndex={-1} className="contact-page">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="lead">{t("lead")}</p>
      </div></section>
      <section className="section"><div className="container layout-aside contact-layout">
        <div className="card contact-card"><ContactForm locale={locale} initialTopic={topic} defaults={{ name: u?.name ?? undefined, email: u?.email ?? undefined, org: u?.organisation ?? undefined }} /></div>
        <div className="contact-side">
          {faq?.fallback && <div className="alert alert-info" role="note"><Icon name="info" /><div>{tc("frPending")}</div></div>}
          {sideHtml && part(sideHtml)}
          <SiteContactInfo />
        </div>
      </div></section>
      {/* FAQ band: contact.html supplies its own head (eyebrow + "FAQ" + art) followed by the questions; the head sits in the left
          column and the questions in the right one (pages.css .contact-faq-grid). */}
      {faqHtml && <section className="section bg-mist contact-faq" aria-labelledby="contact-faq-title"><div className="container contact-faq-grid">
        {part(faqHtml)}
      </div></section>}
    </main>
  );
}
