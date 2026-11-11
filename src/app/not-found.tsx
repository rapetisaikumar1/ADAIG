import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { fontVars } from "@/lib/fonts";

// Root 404 (F1-1): only for URLs outside /en and /fr that the proxy doesn't redirect to a locale (e.g. /x.json, /assets/missing).
// Everything under /<locale>/ uses the localized app/[locale]/not-found.tsx inside the site chrome. The root layout renders no
// <html>, so this page brings its own document; it is bilingual and static.
export const metadata: Metadata = { title: "Page not found · ADAIG", robots: { index: false, follow: false } };

export default function RootNotFound() {
  return (
    <html lang="en" style={fontVars()}>
      <body>
        {/* No site chrome outside /en and /fr: a slim logo bar keeps the page recognisably ADAIG. */}
        <header className="nf-bare"><div className="container">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
          <Link href="/en"><img src="/assets/logo.svg" alt="ADAIG" width={186} height={44} /></Link>
        </div></header>
        <main id="main" tabIndex={-1} className="nf-page">
          <section className="page-hero art-404 nf-hero"><div className="container">
            <span className="eyebrow">Error 404</span>
            <h1>Page not found</h1>
            <p className="lead">This page doesn’t exist or has moved.</p>
            <div className="btn-row">
              <Link className="btn btn-primary" href="/en">ADAIG home</Link>
            </div>
          </div></section>
        </main>
      </body>
    </html>
  );
}
