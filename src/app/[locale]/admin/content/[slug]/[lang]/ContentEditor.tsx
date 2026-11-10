"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { previewContent, saveContent, type EditorError, type PreviewState, type SaveState } from "../../actions";

export type EditorLabels = {
  html: string; hint: string; markerHint?: string; save: string; saving: string; updatePreview: string; updating: string;
  preview: string; previewNote: string; removed: string; unsaved: string; errors: Record<EditorError, string>;
};

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
        <div className="field">
          <label htmlFor="cm-html">{labels.html}</label>
          <textarea id="cm-html" name="html" value={html} onChange={(e) => setHtml(e.target.value)} rows={24} spellCheck={false}
            autoCapitalize="off" autoCorrect="off" lang={lang} aria-describedby={labels.markerHint ? "cm-html-h cm-html-m" : "cm-html-h"} />
          <span className="hint" id="cm-html-h">{labels.hint}</span>
          {labels.markerHint && <span className="hint" id="cm-html-m">{labels.markerHint}</span>}
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
