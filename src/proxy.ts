// Next.js 16 "proxy" (formerly middleware.ts; runs on the Node.js runtime): next-intl locale routing + per-request nonce CSP.
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
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", // fonts are self-hosted by next/font (src/lib/fonts.ts)
    "img-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const res = intl(req);
  // Forward the nonce to the render as request headers (same mechanism NextResponse.next({ request: { headers } }) uses).
  const prev = res.headers.get("x-middleware-override-headers");
  const names = new Set([...(prev ? prev.split(",") : [...req.headers.keys()]), "content-security-policy", "x-nonce", "x-pathname", "x-search"]);
  if (!prev) for (const [k, v] of req.headers) res.headers.set(`x-middleware-request-${k}`, v);
  res.headers.set("x-middleware-override-headers", [...names].join(","));
  res.headers.set("x-middleware-request-content-security-policy", csp);
  res.headers.set("x-middleware-request-x-nonce", nonce);
  // The requested page (always overwritten here, so a client can't inject it on proxied paths). Read by src/lib/session.ts
  // (login `?next=`) and the [locale] layout's generateMetadata (per-route <title>).
  res.headers.set("x-middleware-request-x-pathname", req.nextUrl.pathname.slice(0, 512));
  res.headers.set("x-middleware-request-x-search", req.nextUrl.search.slice(0, 512));
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
// Skips API routes, Next internals, /assets and real static files (by extension, incl. RSC transport files). Any other
// path — even one with a dot, like /en/events/x.y — gets the nonce CSP (it renders a page, usually the 404 page).
// Skipped paths that still render HTML (a 404 for /en/x.json or /assets/x) get the static fallback CSP from next.config.ts
// (STATIC_PATHS there must stay the exact complement of this matcher, or a page would get two CSP headers).
export const config = { matcher: ["/((?!api|_next|assets|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|bmp|txt|xml|json|webmanifest|css|js|mjs|map|woff2?|ttf|otf|eot|pdf|mp4|webm|rsc)$).*)"] };
