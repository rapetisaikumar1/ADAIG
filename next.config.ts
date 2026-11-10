import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Security headers (QA BUG-007). The page CSP is set per request with a nonce in src/proxy.ts (QA BUG-027).
// Here only a strict fallback CSP is set for non-HTML routes (API) that skip the proxy.
const csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
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
  async headers() { return [{ source: "/:path*", headers: securityHeaders }, { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] }]; },
};
export default withNextIntl(nextConfig);
