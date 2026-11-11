"use client";
import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Error boundary for every page under /<locale>/ (Q1-2): shown inside the site header/footer, in the visitor's language, with a
 * retry button. Never shows the error message or stack (production messages are generic anyway); only Next's opaque digest, which
 * matches the server log entry. Errors in the [locale] layout itself (header/footer) fall through to app/global-error.tsx.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("errors");
  const locale = useLocale();
  useEffect(() => { console.error(error); }, [error]);
  const d = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  const digest = typeof d === "string" ? d : null;
  return (
    <main id="main" tabIndex={-1} className="nf-page">
      <section className="page-hero art-404 nf-hero"><div className="container">
        <span className="eyebrow">{t("errorEyebrow")}</span>
        <h1>{t("errorTitle")}</h1>
        <p className="lead">{t("errorBody")}</p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => retry()}>{t("retry")}</button>
          <a className="btn btn-secondary" href={`/${locale}`}>{t("home")}</a>
          <a className="btn btn-secondary" href={`/${locale}/contact`}>{t("contact")}</a>
        </div>
        {digest && <p className="small muted nf-ref">{t("ref", { digest })}</p>}
      </div></section>
    </main>
  );
}
