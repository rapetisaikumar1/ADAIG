import { getLocale, getTranslations } from "next-intl/server";

/**
 * Localized 404 (F1-1, Q1-2, V4-17) for notFound() anywhere under /<locale>/ — unknown URLs reach it through the [...slug]
 * catch-all. It renders inside the [locale] layout, so the site header and footer are there. Next sets status 404 + noindex.
 */
export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations("errors");
  const L = (p: string) => `/${locale}${p}`;
  return (
    <main id="main">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{t("notFoundEyebrow")}</span>
        <h1>{t("notFoundTitle")}</h1>
        <p className="lead">{t("notFoundBody")}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
          <a className="btn btn-on-dark" href={L("")}>{t("home")}</a>
          <a className="btn btn-outline-light" href={L("/events")}>{t("events")}</a>
          <a className="btn btn-outline-light" href={L("/contact")}>{t("contact")}</a>
        </div>
      </div></section>
    </main>
  );
}
