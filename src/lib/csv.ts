/** CSV cell escaping with formula-injection neutralisation (QA BUG-009, OWASP CSV injection). */
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");
