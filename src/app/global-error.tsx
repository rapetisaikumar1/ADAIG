"use client";
import { useEffect } from "react";
import "./globals.css";
import { fontVars } from "@/lib/fonts";

// Last-resort error page (Q1-2): replaces the whole document when the [locale] layout itself fails (e.g. the database is down while
// the header reads the session). No providers are available here, so the copy is inline in both languages; the locale comes from
// the URL. No error details or stack are shown — only Next's opaque digest, which matches the server log entry.
const COPY = {
  en: { title: "Something went wrong", body: "We couldn’t load this page. This is usually temporary — please try again in a moment.", retry: "Try again", home: "Go to the home page", ref: "Reference:" },
  fr: { title: "Une erreur s’est produite", body: "Nous n’avons pas pu charger cette page. C’est généralement temporaire — réessayez dans un instant.", retry: "Réessayer", home: "Aller à l’accueil", ref: "Référence :" },
} as const;

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const locale = typeof window !== "undefined" && /^\/fr(\/|$)/.test(window.location.pathname) ? "fr" : "en";
  const c = COPY[locale];
  const d = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  const digest = typeof d === "string" ? d : null;
  return (
    <html lang={locale} style={fontVars()}>
      <body>
        <title>{`${c.title} · ADAIG`}</title>
        <header className="nf-bare"><div className="container">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
          <a href={`/${locale}`}><img src="/assets/logo.svg" alt="ADAIG" width={186} height={44} /></a>
        </div></header>
        <main id="main" tabIndex={-1} className="nf-page">
          <section className="page-hero art-404 nf-hero"><div className="container">
            <h1>{c.title}</h1>
            <p className="lead">{c.body}</p>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={() => retry()}>{c.retry}</button>
              <a className="btn btn-secondary" href={`/${locale}`}>{c.home}</a>
            </div>
            {digest && <p className="small muted nf-ref">{c.ref} {digest}</p>}
          </div></section>
        </main>
      </body>
    </html>
  );
}
