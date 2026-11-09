import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const dev = process.env.NODE_ENV !== "production";

// Security headers (QA BUG-007). The page CSP is set per request with a nonce in src/middleware.ts (QA BUG-027).
// Here only a strict fallback CSP is set for non-HTML routes (API) that skip the middleware.
const csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
];

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  devIndicators: false,
  async headers() { return [{ source: "/:path*", headers: securityHeaders }, { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] }]; },
};
export default withNextIntl(nextConfig);
