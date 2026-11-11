// Self-hosted brand fonts (A1-5; coordinator decision): next/font downloads them at BUILD time and serves them from our origin
// (no third-party, render-blocking Google Fonts CSS; no visitor IPs sent to Google; CSP font-src 'self').
// Round 5 ("Facet Architecture", SP/r5/DESIGN_R5.md §3):
// - Newsreader (variable wght + optical size; upright + italic) for display, h1, h2 and statements — set at 440–500, never below
//   20px. The italic is used for one emphasised phrase (home statement, About tagline) — keep it to that.
// - Inter (variable) for UI and body text.
// - IBM Plex Mono 400/500 for eyebrows and metadata (dates, refs, status keys). Used site-wide now, so it is preloaded.
// Payload (FA-12, D13): `subsets` only decides what is PRELOADED. next/font still emits an @font-face for every subset of the family
// (latin-ext, vietnamese, cyrillic…) with its unicode-range, so the browser downloads a latin-ext file only on a page that actually
// shows such a character (e.g. a member named Łukasz or Dvořák) and those names stay in the brand faces. Preloading latin only
// (EN + FR are fully covered: é è à ç œ « » ’ – — …) took the preloaded fonts from 10 files / 625 KB to 5 / 340 KB.
// The design tokens keep their names: fontVars() overrides --font-body / --font-display / --font-mono on <html> with the hashed
// next/font family first and the token's original fallback stack after it (src/styles/tokens.css stays the source of the stacks).
import { IBM_Plex_Mono, Inter, Newsreader } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });
const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export function fontVars(): React.CSSProperties {
  return {
    "--font-body": `${inter.style.fontFamily},system-ui,-apple-system,"Segoe UI",sans-serif`,
    "--font-display": `${serif.style.fontFamily},Georgia,serif`,
    "--font-mono": `${mono.style.fontFamily},ui-monospace,monospace`,
  } as React.CSSProperties;
}
