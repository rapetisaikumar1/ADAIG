import type { ReactNode } from "react";
import type { Event } from "@/generated/prisma/client";

/**
 * Joining instructions for an event (webinar link, dial-in, venue details), entered in Admin → Events (accessInfo / accessInfoFr).
 * They are private to attendees: callers render this ONLY for the viewer's own registration with status "confirmed"
 * (event page sidebar, My events). The French text falls back to the English one.
 */
export const eventAccessInfo = (e: Pick<Event, "accessInfo" | "accessInfoFr">, locale: string): string | null =>
  (locale === "fr" && e.accessInfoFr?.trim() ? e.accessInfoFr : e.accessInfo)?.trim() || null;

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"»]+$/; // sentence punctuation after a link is not part of it

/** Plain text → text nodes + links for http(s) URLs only. Nothing is parsed as HTML, so staff input can't inject markup. */
function linkify(line: string, key: string) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    let url = m[0];
    const trail = TRAILING.exec(url)?.[0] ?? "";
    if (trail) url = url.slice(0, -trail.length);
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === "https:" || u.protocol === "http:"; } catch { ok = false; }
    if (!ok) continue;
    const start = m.index ?? 0;
    if (start > last) out.push(line.slice(last, start));
    out.push(<a key={`${key}-${start}`} href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>);
    last = start + url.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/**
 * Renders the joining details as plain text (paragraphs on blank lines, line breaks kept) with clickable web links.
 * Usage (server component), only for a confirmed registration of the signed-in user:
 *   const info = eventAccessInfo(r.event, locale);
 *   {r.status === "confirmed" && info && <EventAccessInfo text={info} title={te("accessTitle")} note={te("accessPrivate")} />}
 */
export function EventAccessInfo({ text, title, note, className = "" }: { text: string; title: string; note?: string; className?: string }) {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={`ev-access${className ? ` ${className}` : ""}`}>
      <p className="ev-access-title"><b>{title}</b></p>
      {paras.map((p, i) => (
        <p key={i} className="ev-access-text">
          {p.split("\n").map((line, j) => <span key={j}>{j > 0 && <br />}{linkify(line, `${i}-${j}`)}</span>)}
        </p>
      ))}
      {note && <p className="small muted ev-access-note">{note}</p>}
    </div>
  );
}
