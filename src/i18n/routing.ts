import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";
import { locales, defaultLocale } from "@/config/site";
// French is kept (messages/fr.json, /fr/* routes) but no longer offered (client, round 6b): no browser-language or cookie
// detection (/ always goes to /en, even with Accept-Language: fr or an old NEXT_LOCALE=fr cookie), no locale cookie and no
// hreflang alternate-link header pointing at /fr. /fr/* URLs still work when opened directly.
export const routing = defineRouting({ locales, defaultLocale, localeDetection: false, localeCookie: false, alternateLinks: false });
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
