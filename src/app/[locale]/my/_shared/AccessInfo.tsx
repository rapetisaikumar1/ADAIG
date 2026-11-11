import { Fragment } from "react";
import { Icon } from "@/components/ui/Icon";

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/**
 * Joining details for a confirmed registrant (Event.accessInfo / accessInfoFr, plain text from Admin → Events).
 * Rendered as text (never as HTML); line breaks are kept and http(s) links become clickable.
 * Styled in member.css (.mbr-access: teal-50 panel with the 3px teal rule, like the public EventAccessInfo panel).
 */
export function AccessInfo({ title, text }: { title: string; text: string }) {
  const parts = text.split(URL_RE);
  return (
    <div className="mbr-access">
      <p className="mbr-access-title"><Icon name="video" size={18} />{title}</p>
      <p className="mbr-access-text">
        {parts.map((p, i) => (i % 2 === 1 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : <Fragment key={i}>{p}</Fragment>))}
      </p>
    </div>
  );
}

/** The joining details in the member's language (French falls back to the English text). */
export const accessText = (e: { accessInfo: string | null; accessInfoFr: string | null }, locale: string) =>
  ((locale === "fr" && e.accessInfoFr?.trim()) || e.accessInfo?.trim()) || null;
