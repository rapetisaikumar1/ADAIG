import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { AdminNotFoundView } from "./admin/_components/AdminNotFoundView";

/**
 * Localized 404 (F1-1, Q1-2, V4-17) for notFound() anywhere under /<locale>/ — unknown URLs reach it through the [...slug]
 * catch-all. It renders inside the [locale] layout, so the site header and footer are there. Next sets status 404 + noindex.
 */
export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations("errors");
  const L = (p: string) => `/${locale}${p}`;
  // Unknown /admin/* URL for a signed-in admin: stay inside the admin portal (its header/footer come from AreaChrome).
  const path = (await headers()).get("x-pathname") ?? "";
  if (/^\/[a-z]{2}\/admin(\/|$)/.test(path) && (await auth())?.user?.role === "admin") return <AdminNotFoundView locale={locale} />;
  return (
    <main id="main" tabIndex={-1} className="nf-page">
      <section className="page-hero art-404 nf-hero"><div className="container">
        <span className="eyebrow">{t("notFoundEyebrow")}</span>
        <h1>{t("notFoundTitle")}</h1>
        <p className="lead">{t("notFoundBody")}</p>
        <div className="btn-row">
          <a className="btn btn-primary" href={L("")}>{t("home")}</a>
          <a className="btn btn-secondary" href={L("/events")}>{t("events")}</a>
          <a className="btn btn-secondary" href={L("/contact")}>{t("contact")}</a>
        </div>
        {/* loading="lazy": this boundary is serialized into every page's RSC payload, and React turns an eager <img> there into
            an image preload hint, so without it every page fetched this SVG (QA-FA-21). Lazy also skips it where .nf-art is hidden. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative facet art (shown where the hero art is hidden) */}
        <img className="nf-art" src="/assets/illustrations/not-found.svg" alt="" width={360} height={280} loading="lazy" />
      </div></section>
    </main>
  );
}
