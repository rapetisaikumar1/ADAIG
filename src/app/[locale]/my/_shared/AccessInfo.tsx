import { Fragment } from "react";

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/**
 * Joining details for a confirmed registrant (Event.accessInfo / accessInfoFr, plain text from Admin → Events).
 * Rendered as text (never as HTML); line breaks are kept and http(s) links become clickable.
 */
export function AccessInfo({ title, text }: { title: string; text: string }) {
  const parts = text.split(URL_RE);
  return (
    <div className="mbr-access" style={{ marginTop: 6, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--mist)", border: "1px solid var(--c-border)" }}>
      <p className="small" style={{ margin: 0, fontWeight: 600 }}>{title}</p>
      <p className="small" style={{ margin: "2px 0 0", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
        {parts.map((p, i) => (i % 2 === 1 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : <Fragment key={i}>{p}</Fragment>))}
      </p>
    </div>
  );
}

/** The joining details in the member's language (French falls back to the English text). */
export const accessText = (e: { accessInfo: string | null; accessInfoFr: string | null }, locale: string) =>
  ((locale === "fr" && e.accessInfoFr?.trim()) || e.accessInfo?.trim()) || null;
