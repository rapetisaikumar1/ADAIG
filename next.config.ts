import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Security headers (QA BUG-007). The page CSP is set per request with a nonce in src/proxy.ts (QA BUG-027).
// Here only fallback CSPs are set for paths that skip the proxy:
// - API routes: nothing to render.
const csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
// - Static-looking paths (/assets/*, /_next/*, *.json, *.txt …). Real files ignore it; when such a path renders the HTML 404 page
//   (e.g. /en/events/x.json) it still gets a strict CSP (S1-4). No nonce is available here, so that page's inline bootstrap scripts
//   don't run: the 404 stays readable server-rendered HTML, which is acceptable for junk URLs.
//   STATIC_PATHS must stay the exact complement of the matcher in src/proxy.ts (same extension list), so no response gets two CSPs.
const staticCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const STATIC_PATHS = "/:path((?:_next|assets).*|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|bmp|txt|xml|json|webmanifest|css|js|mjs|map|woff2?|ttf|otf|eot|pdf|mp4|webm|rsc))";
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Page content is read from src/content at runtime (src/lib/content.ts), so bundle it with the serverless functions.
  outputFileTracingIncludes: { "/**": ["./src/content/**/*"] },
  // Order matters: for the same header key the LAST matching rule wins (so /api/x.json keeps the API CSP).
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: STATIC_PATHS, headers: [{ key: "Content-Security-Policy", value: staticCsp }] },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};
export default withNextIntl(nextConfig);
