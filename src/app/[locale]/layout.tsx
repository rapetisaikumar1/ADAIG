import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { auth } from "@/auth";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { AdminFooter, AdminHeader } from "@/components/AppShell";
import { AreaChrome } from "@/components/ClientBits";
import { fontVars } from "@/lib/fonts";
import { routeTitleKey } from "@/lib/routeTitles";
import "../globals.css";

/**
 * Message namespaces sent to the browser (Q1-1/S1-5). Only Client Components need messages on the client; everything rendered on
 * the server gets the full catalog through getTranslations. KEEP IN SYNC: when a "use client" file calls useTranslations("x"),
 * add "x" here (or to ADMIN_CLIENT_NAMESPACES if it is only used on admin screens). Check with:
 *   grep -rl '"use client"' src | xargs grep -ho 'useTranslations("[^"]*")' | sort -u
 */
const CLIENT_NAMESPACES = ["errors", "contact", "join", "auth", "profile"] as const;
/** Admin-only client strings: sent only to signed-in admins (admin pages are admin-only), never to public visitors. */
const ADMIN_CLIENT_NAMESPACES = ["admin", "adminMembers", "adminEvents", "adminUsers", "adminRoles"] as const;

/**
 * <title> and description, localized (A1-1, V4-1, Q1-13). Every route gets "<section> · ADAIG" from the central route map in
 * src/lib/routeTitles.ts (via the request path the proxy forwards); the home page gets the full site name. A page can still
 * override it with its own `export const metadata` / `generateMetadata` returning `{ title: "…" }` — the template adds " · ADAIG".
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  const path = (await headers()).get("x-pathname") ?? "";
  const key = routeTitleKey(path);
  const site = t("site");
  const privateArea = /^\/[a-z]{2}\/(my|admin|design)(\/|$)/.test(path);
  return {
    title: { template: "%s · ADAIG", default: key ? `${t(key)} · ADAIG` : site },
    description: t("description"),
    applicationName: "ADAIG",
    icons: "/assets/mark.svg",
    ...(privateArea ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const all = await getMessages();
  const s = await auth(); // memoized: the header and footer reuse this lookup
  const isAdmin = s?.user?.role === "admin"; // role re-read from the DB by the session callback (src/auth.ts)
  const names: readonly string[] = isAdmin ? [...CLIENT_NAMESPACES, ...ADMIN_CLIENT_NAMESPACES] : CLIENT_NAMESPACES;
  const messages = Object.fromEntries(names.filter((n) => n in all).map((n) => [n, all[n]]));
  return (
    <html lang={locale} style={fontVars()}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {/* Admin portal (/admin/*): its own minimal header and footer line instead of the public ones — only for signed-in
              admins (everyone else is redirected away from /admin by the rbac page guards and sees the public chrome meanwhile). */}
          <AreaChrome admin={isAdmin ? <AdminHeader locale={locale} /> : null} site={<SiteHeader locale={locale} />} />
          {children}
          <AreaChrome admin={isAdmin ? <AdminFooter /> : null} site={<SiteFooter locale={locale} />} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
