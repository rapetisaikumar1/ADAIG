"use client";
import { useEffect } from "react";
import "./globals.css";

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
    <html lang={locale}>
      <body>
        <title>{`${c.title} · ADAIG`}</title>
        <main id="main">
          <section className="page-hero"><div className="container">
            <h1>{c.title}</h1>
            <p className="lead">{c.body}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
              <button type="button" className="btn btn-on-dark" onClick={() => retry()}>{c.retry}</button>
              <a className="btn btn-outline-light" href={`/${locale}`}>{c.home}</a>
            </div>
            {digest && <p className="small" style={{ marginTop: 24, color: "#aebdd1" }}>{c.ref} {digest}</p>}
          </div></section>
        </main>
      </body>
    </html>
  );
}
