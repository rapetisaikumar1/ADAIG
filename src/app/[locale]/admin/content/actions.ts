"use server";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { currentAdmin } from "@/auth";
import { db } from "@/lib/db";
import { safeLocale, isUniqueViolation, idParam } from "@/lib/validation";
import { CONTENT_LOCALES, CONTENT_TAG, editableContent, fileContent } from "@/lib/content";
import { CONTENT_MAX_CHARS, sanitizeContent } from "@/lib/contentSanitize";
import { sameContent } from "./pretty";

/**
 * Admin → Content. Every change re-checks the admin role in the DB, is conditional on the version the editor loaded
 * (`base` = page updatedAt, or "none" when the page shows the original file), writes a revision + AuditLog entry and
 * expires the content cache so the public page shows the change on the next request.
 */

export type EditorError = "conflict" | "tooLong" | "empty" | "marker" | "unchanged" | "forbidden" | "invalid";
export type SaveState = { error: EditorError; removed?: string[] } | null;
export type PreviewState = { html: string; removed: string[]; error?: EditorError };

const MARKER = "<!--HOME_EVENTS-->";
class Conflict extends Error {}

function target(fd: FormData) {
  const slug = String(fd.get("slug") ?? ""), lang = String(fd.get("lang") ?? "");
  return editableContent(slug) && (CONTENT_LOCALES as readonly string[]).includes(lang) ? { slug, lang } : null;
}
const editorUrl = (locale: string, slug: string, lang: string, q: string) => `/${locale}/admin/content/${slug}/${lang}?${q}`;
/** Removal summary for the success message: short tokens only (tag/attribute names, URL schemes). */
const rmParam = (removed: string[]) => {
  const ok = removed.filter((r) => /^[<>a-z0-9:=/_*-]{1,40}$/i.test(r)).slice(0, 12);
  return ok.length ? `&rm=${encodeURIComponent(ok.join(" "))}` : "";
};

/** What visitors see for this page/locale when there is no override (FR without a file shows the English page). */
async function original(slug: string, lang: string) {
  const own = fileContent(slug, lang);
  if (own !== null || lang === "en") return own ?? "";
  return (await db.contentPage.findUnique({ where: { slug_locale: { slug, locale: "en" } }, select: { html: true } }))?.html ?? fileContent(slug, "en") ?? "";
}

/** Shared validation: size, sanitize, non-empty, homepage events marker. */
function clean(slug: string, raw: string): { html: string; removed: string[] } | { error: EditorError } {
  if (raw.length > CONTENT_MAX_CHARS) return { error: "tooLong" };
  const r = sanitizeContent(raw);
  if (!r.html.trim()) return { error: "empty" };
  // Exactly one marker, as a standalone comment in text context (not inside a tag, an attribute or a <textarea>).
  if (slug === "home" && (r.html.split(MARKER).length !== 2 || r.misplacedMarkers.length)) return { error: "marker" };
  return { html: r.html, removed: r.removed };
}

/** Live preview for the editor (nothing is saved): returns the sanitized HTML with links for the edited locale. */
export async function previewContent(prev: PreviewState, fd: FormData): Promise<PreviewState> {
  if (!(await currentAdmin())) return { ...prev, error: "forbidden" };
  const t = target(fd); if (!t) return { ...prev, error: "invalid" };
  const raw = String(fd.get("html") ?? "");
  if (raw.length > CONTENT_MAX_CHARS) return { ...prev, error: "tooLong" };
  const r = sanitizeContent(raw);
  return { html: r.html.replaceAll("__L__", `/${t.lang}`), removed: r.removed };
}

/** Save = sanitize, upsert the override (conditional on `base`), add a revision, audit, expire the cache. */
export async function saveContent(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin();
  if (!admin) return { error: "forbidden" };
  const t = target(fd); if (!t) return { error: "invalid" };
  const { slug, lang } = t;
  const c = clean(slug, String(fd.get("html") ?? ""));
  if ("error" in c) return { error: c.error };
  const page = await db.contentPage.findUnique({ where: { slug_locale: { slug, locale: lang } } });
  if (String(fd.get("base") ?? "") !== (page ? page.updatedAt.toISOString() : "none")) return { error: "conflict" };
  // The editor shows the HTML with a line break per block (prettyHtml); those breaks alone are not a change.
  if (sameContent(c.html, page?.html ?? (await original(slug, lang)))) return { error: "unchanged", removed: c.removed };
  try {
    await db.$transaction(async (tx) => {
      let id = page?.id;
      if (page) {
        const r = await tx.contentPage.updateMany({ where: { id: page.id, updatedAt: page.updatedAt }, data: { html: c.html, updatedBy: admin.id } });
        if (!r.count) throw new Conflict();
      } else {
        id = (await tx.contentPage.create({ data: { slug, locale: lang, html: c.html, updatedBy: admin.id } })).id;
      }
      await tx.contentRevision.create({ data: { pageId: id!, html: c.html, createdBy: admin.id } });
      await tx.auditLog.create({ data: { actor: admin.id, action: "content.page_saved", target: `${lang}/${slug}` } });
    });
  } catch (e) {
    if (e instanceof Conflict || isUniqueViolation(e)) return { error: "conflict" };
    throw e;
  }
  updateTag(CONTENT_TAG);
  redirect(editorUrl(locale, slug, lang, `msg=saved${rmParam(c.removed)}`));
}

/** Restore an earlier revision: it becomes the published version and is added to the top of the history. */
export async function restoreRevision(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const t = target(fd); if (!t) redirect(`/${locale}/admin/content?msg=invalid`);
  const { slug, lang } = t;
  const rev = await db.contentRevision.findUnique({ where: { id: idParam(fd.get("rev")) }, include: { page: true } });
  if (!rev || rev.page.slug !== slug || rev.page.locale !== lang) redirect(editorUrl(locale, slug, lang, "msg=invalid"));
  if (String(fd.get("base") ?? "") !== rev.page.updatedAt.toISOString()) redirect(editorUrl(locale, slug, lang, "msg=conflict"));
  const c = clean(slug, rev.html); // re-checked with today's rules
  if ("error" in c) redirect(editorUrl(locale, slug, lang, "msg=invalid"));
  if (c.html === rev.page.html) redirect(editorUrl(locale, slug, lang, "msg=unchanged"));
  try {
    await db.$transaction(async (tx) => {
      const r = await tx.contentPage.updateMany({ where: { id: rev.pageId, updatedAt: rev.page.updatedAt }, data: { html: c.html, updatedBy: admin.id } });
      if (!r.count) throw new Conflict();
      await tx.contentRevision.create({ data: { pageId: rev.pageId, html: c.html, createdBy: admin.id } });
      await tx.auditLog.create({ data: { actor: admin.id, action: "content.page_restored", target: `${lang}/${slug}` } });
    });
  } catch (e) {
    if (e instanceof Conflict) redirect(editorUrl(locale, slug, lang, "msg=conflict"));
    throw e;
  }
  updateTag(CONTENT_TAG);
  redirect(editorUrl(locale, slug, lang, "msg=restored"));
}

/** Return to the original: deletes the override (and, by cascade, its revisions); the page shows the file content again. */
export async function resetContent(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const admin = await currentAdmin(); if (!admin) redirect(`/${locale}/login`);
  const t = target(fd); if (!t) redirect(`/${locale}/admin/content?msg=invalid`);
  const { slug, lang } = t;
  const base = new Date(String(fd.get("base") ?? ""));
  if (Number.isNaN(+base)) redirect(editorUrl(locale, slug, lang, "msg=conflict"));
  const r = await db.contentPage.deleteMany({ where: { slug, locale: lang, updatedAt: base } });
  if (!r.count) {
    const still = await db.contentPage.count({ where: { slug, locale: lang } });
    redirect(editorUrl(locale, slug, lang, still ? "msg=conflict" : "msg=alreadyOriginal"));
  }
  await db.auditLog.create({ data: { actor: admin.id, action: "content.page_reset", target: `${lang}/${slug}` } });
  updateTag(CONTENT_TAG);
  redirect(editorUrl(locale, slug, lang, "msg=reset"));
}
