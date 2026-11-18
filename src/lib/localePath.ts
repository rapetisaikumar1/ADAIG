import { defaultLocale } from "@/config/site";
/**
 * Public URL for a locale-less app path. English (the default locale) has NO prefix — next-intl `localePrefix: "as-needed"`
 * (src/i18n/routing.ts) — and the kept French routes keep theirs:
 *   localeHref("en", "/about") → "/about"   localeHref("en") → "/"   localeHref("en", "?x=1") → "/?x=1"
 *   localeHref("fr", "/about") → "/fr/about" localeHref("fr") → "/fr"
 * Old /en/… links still work: the proxy redirects them to the unprefixed URL. Pure module (server + client).
 */
export function localeHref(locale: string, path = ""): string {
  if (locale !== defaultLocale) return "/" + locale + path;
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}
/** The URL prefix of a locale: "" for English, "/fr" for French (content files use it for their `__L__` placeholder). */
export const localePrefix = (locale: string) => (locale === defaultLocale ? "" : "/" + locale);
