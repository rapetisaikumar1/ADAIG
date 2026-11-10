"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { previewContent, saveContent, type EditorError, type PreviewState, type SaveState } from "../../actions";

export type EditorLabels = {
  html: string; hint: string; markerHint?: string; save: string; saving: string; updatePreview: string; updating: string;
  preview: string; previewNote: string; removed: string; unsaved: string; errors: Record<EditorError, string>;
  /** Plain-language guidance for non-technical staff, the collapsed technical notes title, and the "find text" helper. */
  lead: string; techNotes: string; find: string; findPh: string; findNext: string; findNone: string;
  /** Raw template with {i} and {n}, e.g. "{i} of {n}". */
  findCount: string;
};

/** Text as it may be written in the HTML: "&" is often stored as "&amp;", and straight quotes as typographic ones. */
const variants = (q: string) => [...new Set([q, q.replace(/&/g, "&amp;"), q.replace(/'/g, "’"), q.replace(/’/g, "'")])];

/**
 * HTML editor with a live preview. The preview is rendered from server-sanitized HTML (exactly what saving would store),
 * directly in an admin container with the site styles (no iframe). The textarea is controlled so a failed save keeps the text.
 */
export function ContentEditor({ locale, slug, lang, base, initialHtml, initialPreview, labels }: {
  locale: string; slug: string; lang: string; base: string; initialHtml: string; initialPreview: string; labels: EditorLabels;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [pv, preview, previewing] = useActionState<PreviewState, FormData>(previewContent, { html: initialPreview, removed: [] });
  const [saved, save, saving] = useActionState<SaveState, FormData>(saveContent, null);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = html !== initialHtml;
  const area = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ i: number; n: number } | null>(null);

  /** Find the next occurrence (case-insensitive) of the typed words in the HTML, select it and scroll the box to it. */
  const findNext = () => {
    const ta = area.current; const q = query.trim(); if (!ta || !q) return;
    const text = html.toLowerCase();
    const hits: { at: number; len: number }[] = [];
    for (const v of variants(q.toLowerCase())) { let at = text.indexOf(v); while (at >= 0) { hits.push({ at, len: v.length }); at = text.indexOf(v, at + v.length); } }
    hits.sort((a, b) => a.at - b.at);
    if (!hits.length) { setFound({ i: 0, n: 0 }); return; }
    const from = ta.selectionEnd ?? 0;
    const idx = Math.max(0, hits.findIndex((h) => h.at >= from && !(h.at === ta.selectionStart && ta.selectionEnd - ta.selectionStart === h.len)));
    const hit = hits[idx];
    // Scroll: measure the height of the text before the match in the same box (wrapped lines included), then restore it.
    const full = ta.value; ta.value = full.slice(0, hit.at); const top = ta.scrollHeight; ta.value = full;
    ta.focus(); ta.setSelectionRange(hit.at, hit.at + hit.len);
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    setFound({ i: idx + 1, n: hits.length });
  };

  // Preview follows typing (debounced); the button forces an update.
  useEffect(() => {
    if (!dirty && pv.html === initialPreview) return;
    timer.current = setTimeout(() => { if (form.current) { const fd = new FormData(form.current); startTransition(() => preview(fd)); } }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [html]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving with unsaved edits asks for confirmation (browser dialog).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = labels.unsaved; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, labels.unsaved]);

  const err = saved?.error ?? pv.error;
  const removed = pv.removed.length ? pv.removed : saved?.removed ?? [];
  return (
    <>
      <form ref={form} action={save} className="card adm-form cm-editor">
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="lang" value={lang} /><input type="hidden" name="base" value={base} />
        {err && <div className={`alert ${err === "unchanged" ? "alert-info" : "alert-danger"}`} role="alert"><div>{labels.errors[err]}</div></div>}
        <p className="cm-guide" id="cm-guide">{labels.lead}</p>
        <div className="cm-find" role="search">
          <label htmlFor="cm-find" className="sr-only">{labels.find}</label>
          <input id="cm-find" type="search" value={query} placeholder={labels.findPh} autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setFound(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={findNext} disabled={!query.trim()}>{found && found.n > 1 ? labels.findNext : labels.find}</button>
          <span className="small muted" aria-live="polite">{found ? (found.n ? labels.findCount.replace("{i}", String(found.i)).replace("{n}", String(found.n)) : labels.findNone) : ""}</span>
        </div>
        <div className="field">
          <label htmlFor="cm-html">{labels.html}</label>
          <textarea ref={area} id="cm-html" name="html" value={html} onChange={(e) => setHtml(e.target.value)} rows={24} spellCheck={false}
            autoCapitalize="off" autoCorrect="off" lang={lang} wrap="soft" aria-describedby={labels.markerHint ? "cm-guide cm-html-m" : "cm-guide"} />
          {labels.markerHint && <span className="hint" id="cm-html-m">{labels.markerHint}</span>}
          <details className="cm-tech"><summary className="small">{labels.techNotes}</summary><p className="hint" id="cm-html-h">{labels.hint}</p></details>
        </div>
        <div className="adm-form-foot">
          <button type="submit" formAction={preview} className="btn btn-secondary" disabled={previewing}>{previewing ? labels.updating : labels.updatePreview}</button>
          <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? labels.saving : labels.save}</button>
        </div>
      </form>
      <section className="cm-preview-wrap" aria-labelledby="cm-pv-h">
        <div className="adm-card-head"><h2 id="cm-pv-h" className="cm-h2">{labels.preview}</h2>
          <span className="small muted" aria-live="polite">{previewing ? labels.updating : ""}</span></div>
        <p className="small muted cm-note">{labels.previewNote}</p>
        {removed.length > 0 && <div className="alert alert-warning cm-removed" role="status"><div>{labels.removed} <code>{removed.join(" ")}</code></div></div>}
        <div className="cm-preview" lang={lang}><div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: pv.html }} /></div>
      </section>
    </>
  );
}
