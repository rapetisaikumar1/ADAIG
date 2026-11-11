/**
 * Facet graphic system (round 5, DESIGN_R5 §4) — pure presentational server components, no data access.
 *  - <FacetArt name="hero-stack" />  inline isometric assembly (same art as /assets/illustrations/<name>.svg). Pass `assemble`
 *    to let the pieces slide in along the iso axis once (CSS only, components.css .facet-art.is-assembling; off for reduced motion).
 *  - <FacetBand seed={event.id} tone="webinar" />  deterministic isometric strip for listing cards (events, resources).
 *  - <Avatar name="Jordan Member" />  hex-framed monogram (never a silhouette).
 *  - <Status tone="planned">Planned</Status>  the ONE status component (4 public tones + success/danger for portals).
 */
import { FACET_ART, type FacetArtName } from "./facetArt.generated";

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
// Face colours per format (tokens.css --face-*): webinar teal-led, in person blue-led, hybrid mixed, proposed = outline only.
const BAND: Record<Exclude<BandTone, "proposed">, [string, string, string][]> = {
  webinar: [["#11A595", "#1E4E8C", "#0B2545"], ["#7FD8CB", "#5B83B8", "#2A4B73"]],
  "in-person": [["#5B83B8", "#1E4E8C", "#0B2545"], ["#CDEFE9", "#5B83B8", "#2A4B73"]],
  hybrid: [["#11A595", "#1E4E8C", "#0B2545"], ["#C9D7EA", "#5B83B8", "#2A4B73"]],
  neutral: [["#CDEFE9", "#C9D7EA", "#AFC0D6"], ["#7FD8CB", "#5B83B8", "#2A4B73"]],
};

/**
 * A row of isometric columns whose heights come from the seed (an event id or slug), so each card gets its own
 * "skyline" and it never changes between renders. 320×64 viewBox, scales to the card width (preserveAspectRatio slice).
 */
export function FacetBand({ seed, tone = "neutral", className }: { seed: string; tone?: BandTone; className?: string }) {
  const h = hash(seed); const a = 15, C = 0.866;
  const cols = 11; const parts: React.ReactNode[] = [];
  for (let n = 0; n < cols; n++) {
    const height = 1 + ((h >>> (n * 3)) & 3) % 3;          // 1–3 cubes
    const lit = ((h >>> (n + 5)) & 7) === 0;                 // ~1 in 8 columns uses the strong palette
    const pal = tone === "proposed" ? null : BAND[tone][lit ? 0 : 1];
    const x0 = 18 + n * 27, yBase = 47; // columns 27px apart (> the cube width 26) so they never overlap
    for (let k = 0; k < height; k++) {
      const x = x0, y = yBase - (k + 1) * a + a / 2;
      const top = `${x},${y - a / 2} ${x + C * a},${y} ${x},${y + a / 2} ${x - C * a},${y}`;
      const right = `${x},${y + a / 2} ${x + C * a},${y} ${x + C * a},${y + a} ${x},${y + 1.5 * a}`;
      const left = `${x},${y + a / 2} ${x - C * a},${y} ${x - C * a},${y + a} ${x},${y + 1.5 * a}`;
      parts.push(pal
        ? <g key={`${n}-${k}`}><polygon points={left} fill={pal[2]} /><polygon points={right} fill={pal[1]} /><polygon points={top} fill={pal[0]} /></g>
        : <g key={`${n}-${k}`} fill="none" stroke="#1E4E8C" strokeOpacity=".5" strokeDasharray="3 2.5"><polygon points={left} /><polygon points={right} /><polygon points={top} /></g>);
    }
  }
  return (
    <svg className={className ? `facet-band ${className}` : "facet-band"} viewBox="0 0 320 64" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {parts}
    </svg>
  );
}

const initials = (name: string) => name.trim().split(/\s+/).map((x) => x[0] ?? "").slice(0, 2).join("").toUpperCase();

/** Hex-framed monogram (the cube's silhouette). size: sm 32 · md 44 (default) · lg 88. tone: navy (default) · teal · amber. */
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
      <FacetArt name={dark ? "empty-dark" : "empty"} className="empty-art" />
      <H className="empty-title">{title}</H>
      {children && <p>{children}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
