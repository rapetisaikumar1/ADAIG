import { evLabel } from "@/config/site";
import type { Event } from "@prisma/client";
const badge: Record<string, string> = { Webinar: "badge-teal", Chapter: "badge-amber", Conference: "badge-navy" };
export function EventCard({ e, locale, membersFreeLabel }: { e: Event; locale: string; membersFreeLabel: string }) {
  const d = new Date(e.startsAt);
  const title = locale === "fr" && e.titleFr ? e.titleFr : e.title;
  return (
    <article className="card event-card">
      <div className="date-block"><b>{String(d.getDate()).padStart(2, "0")}</b><span>{d.toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { month: "short" })}</span></div>
      <div style={{ display: "grid", gap: 6 }}>
        <div className="tags"><span className={`badge ${badge[e.type] ?? ""}`}>{evLabel(e.type, locale)}</span>{e.memberPriceCents === 0 && <span className="badge badge-green">{membersFreeLabel}</span>}</div>
        <h3><a className="card-link" href={`/${locale}/events/${e.slug}`}>{title}</a></h3>
        <p>{evLabel(e.format, locale)}{e.location ? ` · ${e.location}` : ""} · {e.durationMin} min · {e.cpe} CPE</p>
      </div>
    </article>
  );
}
