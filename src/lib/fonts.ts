// Self-hosted brand fonts (A1-5; coordinator decision): next/font downloads them at BUILD time and serves them from our origin
// (no third-party, render-blocking Google Fonts CSS; no visitor IPs sent to Google; CSP font-src 'self').
// Round 9 ("Signal", reports/round9/DESIGN_R9.md §1.2):
// - Newsreader (variable wght + optical size; upright + italic) for display: h1, .display, statements, big numerals and dark-band
//   headlines — set LIGHT (300) at the display optical size (opsz 72), tight leading. Never below 20px.
// - Figtree (variable 300–900) for UI, h2–h4 and body text (replaces Inter).
// - --font-mono was the round-5 METADATA voice (eyebrows, dates, refs): it now maps to Figtree, so all metadata reads in the UI face.
//   Real code (IDs, slugs, env names) uses --font-code, the system monospace stack. IBM Plex Mono is retired.
// Payload (FA-12, D13): `subsets` only decides what is PRELOADED. next/font still emits an @font-face for every subset of the family
// (latin-ext, vietnamese…) with its unicode-range, so the browser downloads a latin-ext file only on a page that actually
// shows such a character (e.g. a member named Łukasz or Dvořák) and those names stay in the brand faces. EN + FR are fully covered by latin.
// The design tokens keep their names: fontVars() overrides --font-body / --font-display / --font-mono on <html> with the hashed
// next/font family first and the token's original fallback stack after it (src/styles/tokens.css stays the source of the stacks).
import { Figtree, Newsreader } from "next/font/google";

const sans = Figtree({ subsets: ["latin"], display: "swap" });
const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], display: "swap" });

export function fontVars(): React.CSSProperties {
  return {
    "--font-body": `${sans.style.fontFamily},system-ui,-apple-system,"Segoe UI",sans-serif`,
    "--font-display": `${serif.style.fontFamily},Georgia,serif`,
    "--font-mono": `${sans.style.fontFamily},system-ui,-apple-system,"Segoe UI",sans-serif`,
    "--font-code": `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
  } as React.CSSProperties;
}
