import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
import { EDITABLE_CONTENT, fileContent } from "@/lib/content";
export const dynamic = "force-dynamic";

/** Admin → Content: every editable page in EN and FR, original (site files) or edited (DB override). */
export default async function AdminContent({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ f?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("adminContent");
  const sp = await searchParams; const f = sp.f === "edited" ? "edited" : "all";
  const rows = await db.contentPage.findMany({ select: { slug: true, locale: true, updatedAt: true, updatedBy: true } });
  const ids = [...new Set(rows.map((r) => r.updatedBy).filter((x): x is string => !!x))];
  const people = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const fmt = (d: Date) => `${d.toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${locale === "fr" ? "HE" : "ET"}`;
  const pages = EDITABLE_CONTENT.map((p) => {
    const en = rows.find((r) => r.slug === p.slug && r.locale === "en"), fr = rows.find((r) => r.slug === p.slug && r.locale === "fr");
    const last = [en, fr].filter((r) => r !== undefined).sort((a, b) => +b.updatedAt - +a.updatedAt)[0];
    return { ...p, en, fr, frFile: fileContent(p.slug, "fr") !== null, last, name: t(`page_${p.slug}`) };
  });
  const edited = pages.filter((p) => p.en || p.fr);
  const shown = f === "edited" ? edited : pages;
  const tab = (k: "all" | "edited", label: string, n: number) => (
    <a href={`/${locale}/admin/content${k === "all" ? "" : "?f=edited"}`} aria-current={f === k ? "page" : undefined}>{label} <span className="adm-n">{n}</span></a>
  );
  const status = (row: unknown, fallback = false) => row
    ? <span className="badge badge-amber">{t("stEdited")}</span>
    : fallback ? <span className="badge" title={t("stFallbackHint")}>{t("stFallback")}</span> : <span className="badge">{t("stOriginal")}</span>;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/content" />
      <main id="main" className="app-main cm">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="muted cm-lead">{t("lead")}</p></div></div>
        {sp.msg === "invalid" && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><div>{t("msg_invalid")}</div></div>}
        <div className="adm-toolbar"><nav className="adm-filters" aria-label={t("filters")}>{tab("all", t("tabAll"), pages.length)}{tab("edited", t("tabEdited"), edited.length)}</nav></div>
        {shown.length === 0 ? (
          <div className="adm-empty"><p><b>{t("emptyEditedTitle")}</b><br />{t("emptyEditedBody")}</p></div>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")}>
            <table className="adm-table adm-stack cm-table"><caption className="sr-only">{t("tableLabel")}</caption>
              <thead><tr><th scope="col">{t("colPage")}</th><th scope="col">{t("colEn")}</th><th scope="col">{t("colFr")}</th><th scope="col">{t("colChanged")}</th><th scope="col">{t("colActions")}</th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.slug}>
                    <td data-label={t("colPage")}><div className="adm-person"><a href={`/${locale}${p.path}`}>{p.name}</a><span className="small muted">/{locale}{p.path}{p.kind !== "page" ? ` · ${t(`kind_${p.kind}`)}` : ""}</span></div></td>
                    <td data-label={t("colEn")}>{status(p.en)}</td>
                    <td data-label={t("colFr")}>{status(p.fr, !p.frFile)}</td>
                    <td data-label={t("colChanged")}>{p.last ? <div className="adm-person"><span className="nowrap">{fmt(p.last.updatedAt)}</span><span className="small muted">{(p.last.updatedBy && people.get(p.last.updatedBy)) || t("unknownUser")} · {p.last.locale.toUpperCase()}</span></div> : <span className="muted">{t("never")}</span>}</td>
                    <td><div className="adm-actions">
                      <a className="btn btn-secondary btn-sm" href={`/${locale}/admin/content/${p.slug}/en`} aria-label={`${t("editEn")}: ${p.name}`}>{t("editEn")}</a>
                      <a className="btn btn-secondary btn-sm" href={`/${locale}/admin/content/${p.slug}/fr`} aria-label={`${t("editFr")}: ${p.name}`}>{t("editFr")}</a>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted cm-foot">{t("listFoot")}</p>
      </main>
    </div>
  );
}
