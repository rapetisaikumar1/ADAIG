// Self-hosted brand fonts (A1-5; coordinator decision): next/font downloads them at BUILD time and serves them from our origin
// (no third-party, render-blocking Google Fonts CSS; no visitor IPs sent to Google; CSP font-src 'self').
// Same families/weights as before: Inter (400–700 used), Source Serif 4 with its optical-size axis (the display look), IBM Plex Mono 400.
// The design tokens keep their names: fontVars() overrides --font-body / --font-display / --font-mono on <html> with the hashed
// next/font family first and the token's original fallback stack after it (src/styles/tokens.css stays the source of the stacks).
import { IBM_Plex_Mono, Inter, Source_Serif_4 } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], display: "swap" });
// Only admin/design screens use mono: not preloaded, so other pages never download it (the @font-face rule alone costs nothing).
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: "400", display: "swap", preload: false });

export function fontVars(): React.CSSProperties {
  return {
    "--font-body": `${inter.style.fontFamily},system-ui,-apple-system,"Segoe UI",sans-serif`,
    "--font-display": `${serif.style.fontFamily},Georgia,serif`,
    "--font-mono": `${mono.style.fontFamily},ui-monospace,monospace`,
  } as React.CSSProperties;
}
