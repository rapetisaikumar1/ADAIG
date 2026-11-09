import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
const intl = createMiddleware(routing);
const dev = process.env.NODE_ENV !== "production";

/**
 * Per-request nonce CSP (QA BUG-027). Next.js reads the nonce from the request CSP header and adds it to its own inline
 * bootstrap scripts, so script-src needs no 'unsafe-inline'. The app has no other inline scripts.
 * style-src still allows 'unsafe-inline': React `style={{}}` props and the design's inline style attributes would
 * otherwise break, and style attributes cannot carry nonces. That is lower risk than inline script (no script execution).
 */
export function buildCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
export default function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const res = intl(req);
  // Forward the nonce to the render as request headers (same mechanism NextResponse.next({ request: { headers } }) uses).
  const prev = res.headers.get("x-middleware-override-headers");
  const names = new Set([...(prev ? prev.split(",") : [...req.headers.keys()]), "content-security-policy", "x-nonce"]);
  if (!prev) for (const [k, v] of req.headers) res.headers.set(`x-middleware-request-${k}`, v);
  res.headers.set("x-middleware-override-headers", [...names].join(","));
  res.headers.set("x-middleware-request-content-security-policy", csp);
  res.headers.set("x-middleware-request-x-nonce", nonce);
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
export const config = { matcher: ["/((?!api|_next|assets|.*\\..*).*)"] };
