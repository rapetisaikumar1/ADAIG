/**
 * Presentational building blocks shared by the admin pages (round 5, DESIGN_R5 §10.1/§10.3). Server components, no data access:
 *  - <AdminHead>   page header: optional back link · title (+ status chips) · one-line description | ≤1 primary action
 *  - <AdminTabs>   underline tabs with counts for the views of one list (links, aria-current; scroll sideways on phones)
 *  - <AdminSearch> GET search form for a table toolbar (shorter placeholder on phones via <PhonePlaceholder>)
 *  - <AdminEmpty>  designed empty state (facet art, title, one sentence, optional action)
 *  - <AdminReadOnly> the "View only" notice · <AdminDl> read-only label/value details
 */
import { Fragment, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Facet";
import { PhonePlaceholder } from "./PhonePlaceholder";

export function AdminHead({ title, lead, actions, back, meta, media, children }: {
  title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; meta?: ReactNode;
  /** Decorative visual beside the title (e.g. the member's hex avatar), outside the h1 so it never joins its text. */
  media?: ReactNode; children?: ReactNode;
}) {
  return (
    <>
      {back && <a className="adm-back" href={back.href}><Icon name="arrow-left" size={16} />{back.label}</a>}
      <div className="app-head adm-head">
        {media && <div className="adm-head-media" aria-hidden="true">{media}</div>}
        <div className="adm-head-text">
          <h1>{title}</h1>
          {meta && <div className="adm-head-meta">{meta}</div>}
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
        {children}
      </div>
    </>
  );
}

export type TabItem = { key: string; href: string; label: string; count?: number; current: boolean; title?: string };
export function AdminTabs({ label, items }: { label: string; items: TabItem[] }) {
  return (
    <nav className="tabs adm-tabs" aria-label={label}>
      {items.map((x) => (
        <a key={x.key} href={x.href} aria-current={x.current ? "page" : undefined} title={x.title}>
          {x.label}{x.count !== undefined && <span className="tab-n">{x.count}</span>}
        </a>
      ))}
    </nav>
  );
}

export function AdminSearch({ id, name = "q", value, label, placeholder, placeholderShort, action, hidden, button }: {
  id: string; name?: string; value: string; label: string; placeholder: string; placeholderShort?: string; action?: string;
  hidden?: Record<string, string | undefined>; button: string;
}) {
  return (
    <form className="search-bar adm-search" role="search" action={action}>
      {Object.entries(hidden ?? {}).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} name={name} type="search" defaultValue={value} maxLength={200} placeholder={placeholder} />
      <button className="btn btn-secondary btn-sm">{button}</button>
      {placeholderShort && <PhonePlaceholder inputId={id} short={placeholderShort} />}
    </form>
  );
}

/** level: heading level of the empty state's title — 2 under the page h1 (default), 3 inside a panel with its own h2. */
export function AdminEmpty({ title, children, action, level = 2 }: { title: string; children?: ReactNode; action?: ReactNode; level?: 2 | 3 }) {
  return <div className="adm-empty-state"><EmptyState title={title} action={action} level={level}>{children}</EmptyState></div>;
}

/**
 * The one "View only" notice (round 7 fix, VIS m4): every page the role can only read shows it the same way, an info alert with
 * a lock icon at the top of the content. `text` is admin.readOnly unless the page has a more specific reason (e.g. Roles).
 */
export function AdminReadOnly({ text, icon = "lock", className }: { text: ReactNode; icon?: IconName; className?: string }) {
  return <div className={`alert alert-info adm-notice adm-ro-note${className ? ` ${className}` : ""}`} role="note"><Icon name={icon} size={20} /><div>{text}</div></div>;
}

/** One label/value pair of a read-only details list (<AdminDl>). `wide` spans the full row; `empty` shows the "Not set" style. */
export type DlItem = { key: string; label: ReactNode; value: ReactNode; wide?: boolean };
/**
 * Read-only details (VIS m5/m6/m7): a label-over-value grid, two columns from tablet width, one on phones. A null/empty value
 * renders `notSet` in muted text, so an unset field reads as "Not set" rather than an empty box.
 */
export function AdminDl({ items, notSet, className }: { items: DlItem[]; notSet: string; className?: string }) {
  return (
    <dl className={`adm-ro-dl${className ? ` ${className}` : ""}`}>
      {items.map((x) => {
        const empty = x.value === null || x.value === undefined || x.value === "" || x.value === false;
        return <div key={x.key} className={x.wide ? "is-wide" : undefined}><dt>{x.label}</dt><dd className={empty ? "is-empty" : undefined}>{empty ? notSet : x.value}</dd></div>;
      })}
    </dl>
  );
}

/** An email address that may wrap only after "@" or "." (never mid-word), e.g. in narrow table cells. */
export function Email({ value }: { value: string }) {
  const parts = value.split(/(?<=[@.])/);
  return <>{parts.map((x, i) => <Fragment key={i}>{i > 0 && <wbr />}{x}</Fragment>)}</>;
}
