import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { Html } from "@/components/SiteChrome";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
import { CONTENT_LOCALES, editableContent, fileContent } from "@/lib/content";
import { CONTENT_MAX_CHARS } from "@/lib/contentSanitize";
import { resetContent, restoreRevision, type EditorError } from "../../actions";
import { ContentEditor } from "./ContentEditor";
export const dynamic = "force-dynamic";

const MSGS: Record<string, string> = {
  saved: "alert-success", restored: "alert-success", reset: "alert-success", unchanged: "alert-info", alreadyOriginal: "alert-info",
  conflict: "alert-danger", invalid: "alert-danger",
};
const MARKER = "<!--HOME_EVENTS-->";
const ERRORS: EditorError[] = ["conflict", "tooLong", "empty", "marker", "unchanged", "forbidden", "invalid"];

/** Admin → Content → one page in one language: HTML editor + live preview, history with restore, return to the original. */
export default async function ContentEdit({ params, searchParams }: {
  params: Promise<{ locale: string; slug: string; lang: string }>; searchParams: Promise<{ msg?: string; rm?: string; rev?: string }>;
}) {
  const { locale, slug, lang } = await params; setRequestLocale(locale);
  const def = editableContent(slug);
  if (!def || !(CONTENT_LOCALES as readonly string[]).includes(lang)) notFound();
  await requireAdmin(locale);
  const t = await getTranslations("adminContent");
  const sp = await searchParams;

  const [page, enPage] = await Promise.all([
    db.contentPage.findUnique({ where: { slug_locale: { slug, locale: lang } }, include: { revisions: { orderBy: { createdAt: "desc" }, take: 50 } } }),
    lang === "fr" ? db.contentPage.findUnique({ where: { slug_locale: { slug, locale: "en" } }, select: { html: true } }) : null,
  ]);
  const own = fileContent(slug, lang);
  const fallback = !page && own === null; // FR page with no French file: visitors see the English page
  const current = page?.html ?? own ?? enPage?.html ?? fileContent(slug, "en") ?? "";
  const base = page ? page.updatedAt.toISOString() : "none";
  const ids = [...new Set([page?.updatedBy, ...(page?.revisions.map((r) => r.createdBy) ?? [])].filter((x): x is string => !!x))];
  const people = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const who = (id: string | null) => (id && people.get(id)) || t("unknownUser");
  const fmt = (d: Date) => `${d.toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${locale === "fr" ? "HE" : "ET"}`;
  const name = t(`page_${slug}`); const langName = t(`lang_${lang}`); const other = lang === "en" ? "fr" : "en";
  const withLinks = (h: string) => h.replaceAll("__L__", `/${lang}`);
  const viewing = sp.rev ? page?.revisions.find((r) => r.id === sp.rev) : undefined;
  const currentRev = page?.revisions.find((r) => r.html === page.html)?.id;
  const removed = String(sp.rm ?? "").split(" ").filter((r) => /^[<>a-z0-9:=/_*-]{1,40}$/i.test(r)).slice(0, 12);
  const hid = (
    <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="slug" value={slug} /><input type="hidden" name="lang" value={lang} /><input type="hidden" name="base" value={base} /></>
  );
  const editUrl = (l: string, q = "") => `/${locale}/admin/content/${slug}/${l}${q}`;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/content" />
      <main id="main" className="app-main cm">
        <nav className="cm-back small"><a href={`/${locale}/admin/content`}>← {t("back")}</a></nav>
        <div className="app-head">
          <div><span className="eyebrow">{t("eyebrowEdit", { lang: langName })}</span><h1>{name}</h1></div>
          <div className="adm-actions">
            <a className="btn btn-secondary btn-sm" href={editUrl(other)}>{t("otherLang", { lang: t(`lang_${other}`) })}</a>
            <a className="btn btn-secondary btn-sm" href={`/${lang}${def.path}`} target="_blank" rel="noopener">{t("viewLive")} <span aria-hidden="true">↗</span><span className="sr-only"> {t("newTab")}</span></a>
          </div>
        </div>

        {sp.msg && MSGS[sp.msg] && <div className={`alert ${MSGS[sp.msg]}`} role="status" style={{ marginBottom: 16 }}><div>{t(`msg_${sp.msg}`)}</div></div>}
        {sp.msg === "saved" && removed.length > 0 && <div className="alert alert-warning" role="status" style={{ marginBottom: 16 }}><div>{t("removedSaved")} <code>{removed.join(" ")}</code></div></div>}

        <div className="card cm-status">
          <div className="cm-status-row">
            {page ? <span className="badge badge-amber">{t("stEdited")}</span> : fallback ? <span className="badge">{t("stFallback")}</span> : <span className="badge">{t("stOriginal")}</span>}
            <span className="small">{page ? t("statusEdited", { date: fmt(page.updatedAt), name: who(page.updatedBy) }) : fallback ? t("statusFallback") : t("statusOriginal")}</span>
          </div>
          {def.kind !== "page" && <p className="small muted" style={{ margin: 0 }}>{t(`part_${slug}`, { marker: MARKER })}</p>}
        </div>

        {viewing && (
          <section className="card cm-rev" aria-labelledby="cm-rev-h">
            <div className="adm-card-head"><h2 id="cm-rev-h" className="cm-h2">{t("revTitle", { date: fmt(viewing.createdAt) })}</h2>
              <div className="adm-actions">
                {viewing.id !== currentRev && <form action={restoreRevision}>{hid}<input type="hidden" name="rev" value={viewing.id} /><button className="btn btn-accent btn-sm">{t("restore")}</button></form>}
                <a className="btn btn-secondary btn-sm" href={editUrl(lang)}>{t("close")}</a>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>{t("revBy", { name: who(viewing.createdBy) })}{viewing.id === currentRev ? ` · ${t("current")}` : ""}</p>
            <div className="cm-preview" lang={lang}><Html html={withLinks(viewing.html)} /></div>
          </section>
        )}

        <ContentEditor key={base} locale={locale} slug={slug} lang={lang} base={base} initialHtml={current} initialPreview={withLinks(current)}
          labels={{
            html: t("htmlLabel", { lang: langName }), hint: t("htmlHint", { prefix: `/${lang}` }), markerHint: slug === "home" ? t("markerHint", { marker: MARKER }) : undefined,
            save: t("save"), saving: t("saving"), updatePreview: t("updatePreview"), updating: t("updating"), preview: t("preview"),
            previewNote: def.kind === "page" ? t("previewNote") : `${t("previewNote")} ${t("previewPart")}`, removed: t("removedPreview"), unsaved: t("unsaved"),
            errors: Object.fromEntries(ERRORS.map((e) => [e, t(`err_${e}`, { max: CONTENT_MAX_CHARS.toLocaleString(locale), marker: MARKER })])) as Record<EditorError, string>,
          }} />

        <section className="card cm-history" aria-labelledby="cm-hist-h">
          <h2 id="cm-hist-h" className="cm-h2">{t("history")}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t("historyLead")}</p>
          {!page || page.revisions.length === 0 ? (
            <div className="adm-empty"><p>{t("noHistory")}</p></div>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("history")}>
              <table className="adm-stack adm-stack-2 cm-rev-table"><caption className="sr-only">{t("history")}</caption>
                <thead><tr><th scope="col">{t("colSaved")}</th><th scope="col">{t("colBy")}</th><th scope="col">{t("colSize")}</th><th scope="col">{t("colActions")}</th></tr></thead>
                <tbody>
                  {page.revisions.map((r) => (
                    <tr key={r.id}>
                      <td data-label={t("colSaved")}><span className="nowrap">{fmt(r.createdAt)}</span> {r.id === currentRev && <span className="badge badge-green">{t("current")}</span>}</td>
                      <td data-label={t("colBy")}>{who(r.createdBy)}</td>
                      <td data-label={t("colSize")}>{t("chars", { n: r.html.length.toLocaleString(locale) })}</td>
                      <td><div className="adm-actions">
                        <a className="btn btn-secondary btn-sm" href={editUrl(lang, `?rev=${r.id}#cm-rev-h`)} aria-label={`${t("previewRev")}: ${fmt(r.createdAt)}`}>{t("previewRev")}</a>
                        {r.id !== currentRev && <form action={restoreRevision}>{hid}<input type="hidden" name="rev" value={r.id} /><button className="btn btn-secondary btn-sm" aria-label={`${t("restore")}: ${fmt(r.createdAt)}`}>{t("restore")}</button></form>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {page && (
          <section className="card cm-reset" aria-labelledby="cm-reset-h">
            <h2 id="cm-reset-h" className="cm-h2">{t("reset")}</h2>
            <p className="small muted" style={{ margin: 0 }}>{own === null ? t("resetBodyFallback") : t("resetBody")}</p>
            <div className="adm-actions">
              <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("reset")}…</summary>
                <form action={resetContent}>{hid}<p className="small" style={{ margin: 0 }}>{t("resetConfirm", { page: name, lang: langName })}</p><button className="btn btn-danger btn-sm">{t("resetYes")}</button></form>
              </details>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
