import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

// Root 404 (F1-1): only for URLs outside /en and /fr that the proxy doesn't redirect to a locale (e.g. /x.json, /assets/missing).
// Everything under /<locale>/ uses the localized app/[locale]/not-found.tsx inside the site chrome. The root layout renders no
// <html>, so this page brings its own document; it is bilingual and static.
export const metadata: Metadata = { title: "Page not found · ADAIG", robots: { index: false, follow: false } };

export default function RootNotFound() {
  return (
    <html lang="en">
      <body>
        <main id="main">
          <section className="page-hero"><div className="container">
            <span className="eyebrow">Error 404</span>
            <h1>Page not found</h1>
            <p className="lead">This page doesn’t exist or has moved.</p>
            <p className="lead" lang="fr">Cette page n’existe pas ou a été déplacée.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
              <Link className="btn btn-on-dark" href="/en">ADAIG home</Link>
              <Link className="btn btn-outline-light" href="/fr" lang="fr">Accueil ADAIG (français)</Link>
            </div>
          </div></section>
        </main>
      </body>
    </html>
  );
}
