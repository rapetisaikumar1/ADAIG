/**
 * ADAIG icon set (round 5, DESIGN_R5 §6.20): 24px grid, 1.5px stroke, round caps/joins, currentColor. One set only; isometric
 * motifs (cube, layers, hexagon) use the logo's 30° axes. Pure presentational server component — no data access.
 * In content HTML (src/content/*.html) copy the same markup inline: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
 * stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg> (the sanitizer allows path/circle/rect).
 */
export const ICONS = {
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  "arrow-up-right": '<path d="M7 17 17 7M8 7h9v9"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="12" cy="5.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="12" cy="18.5" r="1.1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  sort: '<path d="M8 5v14M5 16l3 3 3-3M16 19V5M13 8l3-3 3 3"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.6c1.7.6 2.7 2.1 3 4.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  "map-pin": '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z"/>',
  video: '<rect x="3.5" y="6.5" width="12" height="11" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
  building: '<path d="M5 20.5v-15l7-2 7 2v15M3.5 20.5h17M9 8.5h.01M15 8.5h.01M9 12h.01M15 12h.01M9 15.5h.01M15 15.5h.01"/>',
  shield: '<path d="M12 3.5 19 6.3v5.2c0 4.6-3 7.9-7 9-4-1.1-7-4.4-7-9V6.3z"/><path d="m9 12 2 2 4-4"/>',
  scale: '<path d="M12 4v16M8 20h8M5 7h14M5 7l-2.8 6.5M5 7l2.8 6.5M2.2 13.5a2.8 2.8 0 0 0 5.6 0M19 7l-2.8 6.5M19 7l2.8 6.5M16.2 13.5a2.8 2.8 0 0 0 5.6 0"/>',
  document: '<path d="M6.5 3.5H14l4.5 4.5v12.5h-12z"/><path d="M14 3.5V8h4.5M9.5 12.5h5M9.5 16h5"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  layers: '<path d="m12 3.5 8.5 4.9-8.5 4.9-8.5-4.9z"/><path d="m3.5 12.4 8.5 4.9 8.5-4.9M3.5 16.4l8.5 4.9 8.5-4.9"/>',
  cube: '<path d="m12 3 8 4.6v8.8L12 21l-8-4.6V7.6z"/><path d="m4 7.6 8 4.6 8-4.6M12 12.2V21"/>',
  hexagon: '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2.5L13 19V5L7.5 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  refresh: '<path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L20.5 8.5M20.5 3.5v5h-5M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3.5 15.5M3.5 20.5v-5h5"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 12.5h17"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  inbox: '<path d="m3.5 13.5 2.5-8h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5h-14a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 9.5h18M6.5 14.5h4"/>',
  chart: '<path d="M4 20h16M7 16v-4M12 16V7M17 16v-7"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5l-8 8M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4M12 16.8h.01"/>',
  "check-circle": '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  "x-circle": '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/>',
  "log-out": '<path d="M9 20.5H5.5A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5H9M15.5 16.5 20 12l-4.5-4.5M20 12H9"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  home: '<path d="m4 11 8-6.5 8 6.5M6 9.5V20h12V9.5"/>',
  "id-badge": '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M10 3.5v2h4v-2"/><circle cx="12" cy="11" r="2.5"/><path d="M8 17.2c.6-1.9 2.1-3 4-3s3.4 1.1 4 3"/>',
  key: '<circle cx="8.5" cy="15.5" r="4.5"/><path d="m11.7 12.3 8.3-8.3M17.2 6.8l2.6 2.6M14.6 9.4l2.2 2.2"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** Decorative by default (aria-hidden). Pass `label` only when the icon is the sole content of a control. */
export function Icon({ name, size = 20, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}
