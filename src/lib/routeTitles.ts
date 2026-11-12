// Central per-route <title> map (A1-1). Keys are message keys in the "meta" namespace (messages/en.json + fr.json).
// Used by the [locale] layout's generateMetadata (from the proxy's x-pathname header) and by the [...slug] content page.
// Pages with a more specific title (an event's name, a member's name…) export their own metadata; this map is the fallback.

/** Public content pages served by src/app/[locale]/[...slug] (slug → meta key). */
export const CONTENT_TITLES: Record<string, string> = {
  about: "about", principles: "principles", governance: "governance", community: "community", chapters: "chapters",
  resources: "resources", news: "news", advocacy: "advocacy", careers: "careers", vendors: "vendors", legal: "legal",
  "design/brand": "brand", "design/components": "components",
};

const ROUTES: [RegExp, string][] = [
  [/^membership$/, "membership"],
  [/^join(\/checkout)?$/, "join"],
  [/^contact$/, "contact"],
  [/^events$/, "events"],
  [/^events\/[^/]+\/checkout$/, "eventRegistration"],
  [/^events\/[^/]+$/, "events"],
  [/^forgot-password$/, "forgotPassword"],
  [/^reset-password$/, "resetPassword"],
  [/^login$/, "login"],
  [/^signup$/, "signup"],
  [/^my(\/.*)?$/, "my"],
  [/^admin\/dashboard$/, "adminDashboard"],
  [/^admin\/members\/new$/, "adminNewAccount"],
  [/^admin\/members$/, "adminMembers"],
  [/^admin\/members\/[^/]+$/, "adminMember"],
  [/^admin\/events$/, "adminEvents"],
  [/^admin\/events\/[^/]+$/, "adminEvent"],
  [/^admin\/messages$/, "adminMessages"],
  [/^admin\/users\/new$/, "adminNewUser"],
  [/^admin\/users$/, "adminUsers"],
  [/^admin\/users\/[^/]+$/, "adminUser"],
  [/^admin\/roles\/new$/, "adminNewRole"],
  [/^admin\/roles$/, "adminRoles"],
  [/^admin\/roles\/[^/]+$/, "adminRole"],
  [/^admin\/no-access$/, "adminNoAccess"],
  [/^admin\/settings$/, "adminSettings"],
  [/^admin\/audit$/, "adminAudit"],
  [/^admin\/system$/, "adminSystem"],
  [/^admin\/corporate$/, "adminCorporate"],
  [/^admin\/chapter$/, "adminChapter"],
  [/^admin(\/.*)?$/, "admin"],
];

/** Meta key for a request path like "/fr/admin/members/abc" (null = home page or unknown → the site name). */
export function routeTitleKey(path: string): string | null {
  const rest = path.replace(/^\/[a-z]{2}(?=\/|$)/, "").replace(/^\/+|\/+$/g, "");
  if (!rest) return null;
  if (CONTENT_TITLES[rest]) return CONTENT_TITLES[rest];
  for (const [re, key] of ROUTES) if (re.test(rest)) return key;
  return null;
}
