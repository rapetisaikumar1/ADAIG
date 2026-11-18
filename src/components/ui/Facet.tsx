/**
 * Facet graphic system (round 5, DESIGN_R5 §4) — pure presentational server components, no data access.
 *  - <FacetArt name="hero-stack" />  inline isometric assembly (same art as /assets/illustrations/<name>.svg). Pass `assemble`
 *    to let the pieces slide in along the iso axis once (CSS only, components.css .facet-art.is-assembling; off for reduced motion).
 *  - <FacetBand seed={event.id} tone="webinar" />  deterministic isometric strip for listing cards (events, resources).
 *  - <Avatar name="Jordan Member" />  hex-framed monogram (never a silhouette).
 *  - <Status tone="planned">Planned</Status>  the ONE status component (4 public tones + success/danger for portals).
 */
import { FACET_ART, type FacetArtName } from "./facetArt.generated";
import { SIGNAL_EMPTY } from "./signalArt.generated";

export function FacetArt({ name, className, assemble = false }: { name: FacetArtName; className?: string; assemble?: boolean }) {
  const cls = ["facet-art", assemble ? "is-assembling" : "", className ?? ""].filter(Boolean).join(" ");
  return <span className={cls} aria-hidden="true" dangerouslySetInnerHTML={{ __html: FACET_ART[name] }} />;
}

/** FNV-1a 32-bit — tiny, dependency-free, stable across server renders. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

type BandTone = "webinar" | "in-person" | "hybrid" | "proposed" | "neutral";
/** Dot colours per event format, on the Harbor card band (round 9 "Signal"): [main, accent]. Proposed events draw hollow rings. */
const BAND: Record<Exclude<BandTone, "proposed">, [string, string]> = {
  webinar: ["#2BEEAD", "#2BEEAD"],
  "in-person": ["#4F8AD6", "#2BEEAD"],
  hybrid: ["#2BEEAD", "#4F8AD6"],
  neutral: ["#8FA6A6", "#2BEEAD"],
};

/**
 * Round 9: a seeded halftone strip (the signal field) for listing cards — each event gets its own focal point and spread from its
 * slug, so the pattern never changes between renders. 320×84 viewBox on the Harbor .card-band; decorative (aria-hidden).
 */
export function FacetBand({ seed, tone = "neutral", className }: { seed: string; tone?: BandTone; className?: string }) {
  const h = hash(seed);
  const fx = 70 + (h % 190), fy = 18 + ((h >>> 9) % 48), reach = 150 + ((h >>> 15) % 90);
  const s = 11, dx = s * 0.866;
  const pal = tone === "proposed" ? null : BAND[tone];
  const dots: React.ReactNode[] = [];
  for (let i = 0; i * dx <= 330; i++) {
    for (let j = 0; j * s <= 92; j++) {
      const x = i * dx, y = j * s + (i % 2 ? s / 2 : 0);
      const d = Math.hypot(x - fx, (y - fy) * 1.4) / reach;
      if (d >= 1) continue;
      const r = 3.9 * (1 - d) ** 1.4;
      if (r < 0.6) continue;
      const accent = ((h >>> ((i + j) % 24)) & 15) === 0;
      dots.push(pal
        ? <circle key={`${i}-${j}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(2)} fill={accent ? pal[1] : pal[0]} fillOpacity={accent ? 1 : 0.85} />
        : <circle key={`${i}-${j}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r={Math.max(r - 0.6, 0.8).toFixed(2)} fill="none" stroke="#8FA6A6" strokeWidth="1" />);
    }
  }
  return (
    <svg className={className ? `facet-band ${className}` : "facet-band"} viewBox="0 0 320 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {dots}
    </svg>
  );
}

const initials = (name: string) => name.trim().split(/\s+/).map((x) => x[0] ?? "").slice(0, 2).join("").toUpperCase();

/** Round monogram (round 9; was hex-framed). size: sm 32 · md 44 (default) · lg 88. tone: navy (default) · teal · amber. */
export function Avatar({ name, size = "md", tone }: { name: string; size?: "sm" | "md" | "lg"; tone?: "teal" | "amber" }) {
  const cls = ["avatar", size === "md" ? "" : size, tone ?? ""].filter(Boolean).join(" ");
  return <span className={cls} aria-hidden="true">{initials(name)}</span>;
}

export type StatusTone = "available" | "planned" | "dev" | "members" | "pending" | "neutral" | "success" | "danger";
/**
 * One status chip per card, one tone per meaning (DESIGN_R5 §6.4): available = live/active/published/confirmed/paid ·
 * planned = coming soon · dev = planned/proposed/draft/in development · members = members only · pending = needs someone's action
 * (pending review, awaiting payment, new) · neutral = factual, no action (no membership, handled, past) · danger = rejected/canceled/
 * locked. "success" is kept as an alias of available.
 */
export function Status({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

/**
 * Designed empty state: small facet art (≤160px), a heading that names what is empty, one sentence, one action.
 * `level` sets the heading element so the outline stays sequential (FA-8): 2 (default) when it sits right under the page h1,
 * 3 inside a section that already has an h2. The look is the same at every level.
 */
export function EmptyState({ title, children, action, dark = false, level = 2 }: {
  title: string; children?: React.ReactNode; action?: React.ReactNode; dark?: boolean; level?: 2 | 3 | 4;
}) {
  const H = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div className="empty-state">
      <span className={dark ? "facet-art empty-art is-dark" : "facet-art empty-art"} aria-hidden="true" dangerouslySetInnerHTML={{ __html: SIGNAL_EMPTY }} />
      <H className="empty-title">{title}</H>
      {children && <p>{children}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
