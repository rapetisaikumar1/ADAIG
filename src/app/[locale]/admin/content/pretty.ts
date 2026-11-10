/**
 * Readable layout for the content editor: page HTML is stored mostly on a few very long lines, which non-technical staff
 * can't scan. This puts each block element (section, div, p, headings, list items, table rows…) on its own line by adding
 * a line break between two adjacent tags only, never inside text, <pre>, <textarea> or comments. Line breaks between block
 * elements don't change how the page looks. Idempotent: running it twice gives the same result.
 */
const BLOCK = "section|article|aside|header|footer|nav|main|div|p|h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|details|summary|figure|figcaption|blockquote|form|fieldset|hr";
const AFTER_CLOSE = new RegExp(`(</(?:${BLOCK})>)(?=<)`, "gi"); // "</p><" → "</p>\n<"
const BEFORE_OPEN = new RegExp(`>(?=<(?:${BLOCK})[\\s>/])`, "gi"); // "><section" → ">\n<section"
const KEEP = /(<pre\b[\s\S]*?<\/pre>|<textarea\b[\s\S]*?<\/textarea>|<!--[\s\S]*?-->)/gi;

export function prettyHtml(html: string): string {
  return html.split(KEEP).map((part, i) => (i % 2 ? part : part.replace(AFTER_CLOSE, "$1\n").replace(BEFORE_OPEN, ">\n"))).join("");
}

/** True when two versions differ only by the line breaks prettyHtml adds (so opening and saving untouched text is "no change"). */
export const sameContent = (a: string, b: string) => a === b || prettyHtml(a) === prettyHtml(b);
