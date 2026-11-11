/**
 * Presentational building blocks shared by every member page (/my/*), so headers, notices and section titles read the same
 * everywhere (DESIGN_R5 §10.1–10.2). No data access.
 */
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * Portal page header (`.app-head`): optional quiet kicker line (e.g. "Welcome back, <name>") → h1 → one-line description,
 * with up to one primary action on the right. `lead` lives inside the header so it always sits right under the title (VPo-6).
 */
export function PageHead({ title, lead, kicker, actions, media }: { title: string; lead?: React.ReactNode; kicker?: React.ReactNode; actions?: React.ReactNode; media?: React.ReactNode }) {
  return (
    <div className="app-head mbr-head">
      <div className="mbr-head-main">
        {media}
        <div className="mbr-head-text">
          {kicker && <p className="mbr-kicker">{kicker}</p>}
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

type Tone = "info" | "success" | "warning" | "danger";
const NOTICE_ICON: Record<Tone, IconName> = { info: "info", success: "check-circle", warning: "alert", danger: "x-circle" };
/** Alert with the tone's icon (§6.7). `role="alert"` only for errors that follow an action; everything else is a status. */
export function Notice({ tone, title, role = "status", children, className, id }: { tone: Tone; title?: React.ReactNode; role?: "status" | "alert" | "note"; children?: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`alert alert-${tone}${className ? ` ${className}` : ""}`} role={role}>
      <Icon name={NOTICE_ICON[tone]} />
      <div>{title && <b>{title}</b>}{children}</div>
    </div>
  );
}

/** Section title row: h2 + optional count chip (real counts only) + optional trailing link/action. */
export function SectionHead({ id, title, count, children }: { id: string; title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="mbr-sec-head">
      <h2 id={id}>{title}{count !== undefined && <span className="mbr-count" aria-hidden="true">{count}</span>}</h2>
      {children}
    </div>
  );
}

/** Drops a trailing "→" from link copy when the link is styled with `.link-arrow` (which draws its own arrow). */
export const noArrow = (s: string) => s.replace(/\s*→\s*$/, "");
