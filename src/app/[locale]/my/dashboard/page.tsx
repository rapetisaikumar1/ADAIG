import { redirect } from "next/navigation";
import type { Locale } from "@/config/site";
import { safeLocale } from "@/lib/validation";
export const dynamic = "force-dynamic";

/**
 * Former member dashboard. My membership (/my/billing) is now the member home and shows everything members must still see
 * (application received / welcome / renewal / lapsed / rejected notices, order and ticket messages, next event, CPE hours).
 * Old links, bookmarks and redirects (?applied=1, ?welcome=1, ?already=1, ?msg=…) keep working: the query string is passed on.
 * Sign-in is checked on My membership itself (signed-out visitors go to the login page from there).
 */
export default async function Dashboard({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = safeLocale((await params).locale); // whitelisted: never build a redirect from a raw path segment
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, x);
  const q = qs.toString();
  redirect(`/${locale}/my/billing${q ? `?${q}` : ""}`);
}
