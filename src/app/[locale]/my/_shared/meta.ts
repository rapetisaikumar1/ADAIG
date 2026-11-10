import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type MemberPage = "dashboard" | "billing" | "profile" | "events" | "community" | "directory";
/** Page title for a member-area page (its sidenav label, in the page's language); the layout adds the site suffix. Not indexed. */
export const memberMetadata = (page: MemberPage) => async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "member" });
  return { title: t(page), robots: { index: false, follow: false } };
};
