import sanitizeHtml from "sanitize-html";

/**
 * Sanitizer for staff-edited page content (Admin → Content). Allowlist built from what src/content uses today
 * (classes, ids, inline styles, aria-* / data-* attributes, tables, details/summary, inline SVG icons and charts,
 * disabled form controls in the design-reference pages, links). Removes scripts, styles, iframes, event handlers
 * (on*), javascript:/data: URLs and anything else not listed. Tag and attribute case is kept (SVG viewBox,
 * linearGradient) and entities are left as written, so unchanged content survives a save as-is.
 */

export const CONTENT_MAX_CHARS = 400_000;

const HTML_TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button", "caption", "cite", "code", "col",
  "colgroup", "data", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer", "h1",
  "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "input", "ins", "kbd", "label", "legend", "li", "main", "mark",
  "meter", "nav", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "s", "samp", "section", "select",
  "small", "source", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time",
  "tr", "u", "ul", "var", "wbr",
];
const SVG_TAGS = [
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "text", "tspan", "defs", "linearGradient",
  "radialGradient", "stop", "clipPath", "mask", "pattern", "title", "desc",
];
/** SVG names whose camelCase must survive (htmlparser2 keeps the source case; everything else is lower-cased). */
const SVG_CASE = new Map([...SVG_TAGS, "viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "patternUnits",
  "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits", "textLength", "lengthAdjust",
  "spreadMethod", "startOffset", "pathLength"].map((n) => [n.toLowerCase(), n]));

const GLOBAL_ATTRS = ["class", "id", "style", "title", "lang", "dir", "hidden", "role", "tabindex", "translate", "aria-*", "data-*"];
const SVG_ATTRS = [
  "viewBox", "preserveAspectRatio", "xmlns", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "fx",
  "fy", "d", "points", "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "stroke-opacity", "opacity",
  "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "patternUnits",
  "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits", "font-family", "font-size",
  "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline", "letter-spacing", "textLength",
  "lengthAdjust", "dx", "dy", "rotate", "focusable", "vector-effect", "shape-rendering", "pathLength", "visibility", "display",
];
const ALLOWED_ATTRS: Record<string, string[]> = {
  "*": GLOBAL_ATTRS,
  a: ["href", "target", "rel", "hreflang", "download"],
  img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"],
  source: ["srcset", "sizes", "type", "media", "width", "height"],
  td: ["colspan", "rowspan", "headers"], th: ["colspan", "rowspan", "headers", "scope", "abbr"], col: ["span"], colgroup: ["span"],
  ol: ["start", "reversed", "type"], li: ["value"], details: ["open", "name"], time: ["datetime"], data: ["value"],
  del: ["datetime"], ins: ["datetime"], blockquote: ["cite"], q: ["cite"],
  label: ["for"], button: ["type", "disabled", "name", "value"], fieldset: ["disabled"],
  input: ["type", "name", "value", "placeholder", "checked", "disabled", "readonly", "required", "min", "max", "step", "maxlength",
    "minlength", "size", "autocomplete", "inputmode", "pattern"],
  select: ["name", "disabled", "multiple", "size", "required"], option: ["value", "selected", "disabled", "label"],
  optgroup: ["label", "disabled"], textarea: ["name", "rows", "cols", "placeholder", "disabled", "readonly", "maxlength", "required"],
  progress: ["value", "max"], meter: ["value", "min", "max", "low", "high", "optimum"], output: ["for", "name"],
  ...Object.fromEntries(SVG_TAGS.map((t) => [t, SVG_ATTRS])),
};
const SCHEMES = ["http", "https", "mailto", "tel"];
const URL_ATTRS = new Set(["href", "src", "srcset", "cite", "xlink:href", "action", "formaction"]);
/** Markers the app replaces at render time (e.g. the homepage's live events list). Comments are otherwise removed. */
const MARKER = /<!--([A-Z][A-Z0-9_]{2,40})-->/g;
const MARK_OPEN = "\uE000", MARK_CLOSE = "\uE001";

const ALL_TAGS = new Set([...HTML_TAGS, ...SVG_TAGS]);
const allowedAttr = (tag: string, a: string) =>
  [...(ALLOWED_ATTRS[tag] ?? []), ...GLOBAL_ATTRS].some((p) => (p.endsWith("*") ? a.startsWith(p.slice(0, -1)) : p === a));
/**
 * Inline styles are kept verbatim (the design uses them) unless they could load or run something. CSS escapes
 * (`u\72l(`) and named character references other than the basic ones (`&bsol;`, `&lpar;`) are refused outright (no
 * content uses them in a style), and CSS comments are ignored when testing, so `url(` / `expression(` can't be smuggled past.
 */
const unsafeStyle = (v: string) => {
  const s = decodeEntities(v);
  return s.includes("\\") || /&(?!(?:amp|quot|apos|lt|gt|nbsp);)[a-z]/i.test(s) || /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import|url\s*\(/i.test(stripLoose(s.replace(/\/\*[\s\S]*?(\*\/|$)/g, "")));
};
/** A numeric character reference's character; out-of-range values and surrogates become U+FFFD (as browsers do), 0 a space. */
const codePoint = (n: number) => String.fromCodePoint(!n ? 32 : !Number.isFinite(n) || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n);
/** Decodes numeric/named-colon entities. */
const decodeEntities = (v: string) => v
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => codePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => codePoint(Number(d)))
  .replace(/&colon;/gi, ":").replace(/&tab;|&newline;/gi, "");
/** Strips whitespace/control chars, as browsers do before reading a URL scheme. */
const stripLoose = (v: string) => v.replace(/[\u0000- \u007f-\u009f]+/g, "");
/** Decodes entities and strips whitespace/control chars, as browsers do before reading a URL scheme. */
const decodeLoose = (v: string) => stripLoose(decodeEntities(v));
function unsafeUrl(v: string) {
  const s = decodeLoose(v);
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  return m ? !SCHEMES.includes(m[1].toLowerCase()) : /^[\\/]{2}/.test(s); // other schemes; protocol-relative //host
}

const urlLabel = (v: string) => { const s = decodeLoose(v).toLowerCase(); const m = /^([a-z][a-z0-9+.-]*):/.exec(s); return m ? `${m[1]}:` : "//"; };

/** `misplacedMarkers`: markers found inside a tag, an attribute value or a <textarea>/<title>; they are kept as plain text, never as markers. */
export type SanitizeResult = { html: string; removed: string[]; misplacedMarkers: string[] };

/** Cleans staff-entered HTML. `removed` lists what was dropped (tag names, attribute names, "javascript:"-style URLs). */
export function sanitizeContent(input: string): SanitizeResult {
  const removed = new Set<string>();
  // Postgres rejects NUL; other C0 controls (except tab/newline/CR) have no place in page content either.
  const src = input.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uE000\uE001]/g, "")
    .replace(MARKER, (_, name) => `${MARK_OPEN}${name}${MARK_CLOSE}`);
  // allowedEmptyAttributes is a sanitize-html 2.12+ option that @types/sanitize-html does not list yet.
  const options: sanitizeHtml.IOptions & { allowedEmptyAttributes: string[] } = {
    allowedTags: [...ALL_TAGS],
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: SCHEMES,
    allowedSchemesAppliedToAttributes: [...URL_ATTRS],
    allowProtocolRelative: false,
    allowedEmptyAttributes: ["alt", "value", "placeholder"],
    selfClosing: ["img", "br", "hr", "input", "col", "wbr", "source"],
    nonTextTags: ["script", "style", "xmp", "noscript", "noembed", "noframes", "template", "iframe", "object", "embed", "plaintext"],
    parseStyleAttributes: false,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false, decodeEntities: false },
    transformTags: {
      "*": (tagName, attribs) => {
        const tag = SVG_CASE.get(tagName.toLowerCase()) ?? tagName.toLowerCase();
        if (!ALL_TAGS.has(tag)) { removed.add(`<${tag}>`); return { tagName: tag, attribs: {} }; }
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          const name = SVG_CASE.get(k.toLowerCase()) ?? k.toLowerCase();
          if (!allowedAttr(tag, name)) { removed.add(name); continue; }
          if (URL_ATTRS.has(name) && (name === "srcset" ? v.split(",").some((c) => unsafeUrl(c.trim())) : unsafeUrl(v))) { removed.add(`${name}=${urlLabel(v)}`); continue; }
          if (name === "style" && unsafeStyle(v)) { removed.add("style"); continue; }
          out[name] = v;
        }
        return { tagName: tag, attribs: out };
      },
    },
  };
  const html = sanitizeHtml(src, options);
  // Serialize like the source files: <img …> (no " />") and empty SVG shapes as <path …/>. Attribute values are escaped, so [^>] is safe.
  const tidy = html.replace(/<(img|br|hr|input|col|wbr|source)((?:\s[^>]*?)?) \/>/g, "<$1$2>")
    .replace(/<(path|circle|ellipse|line|polyline|polygon|rect|stop)((?:\s[^>]*)?)><\/\1>/g, "<$1$2/>");
  // A marker only counts as a standalone comment in text context: one inside a tag/attribute or in RCDATA (<textarea>, <title>)
  // is written as escaped text (displays the same, never matches the marker). One left-to-right pass tracks the context;
  // in the output, text and attribute values are escaped, so every "<" / ">" here is real markup.
  const misplaced: string[] = [];
  let inTag = false, rcdata = "";
  const restored = tidy.replace(new RegExp(`<(/?)(textarea|title)(?=[\\s/>])|[<>]|${MARK_OPEN}([A-Z][A-Z0-9_]{2,40})${MARK_CLOSE}`, "g"), (m, close: string | undefined, rc: string | undefined, name: string | undefined) => {
    if (name) {
      if (inTag || rcdata) { misplaced.push(name); return `&lt;!--${name}--&gt;`; }
      return `<!--${name}-->`;
    }
    if (rc) { inTag = true; rcdata = close ? "" : rc; } else inTag = m === "<";
    return m;
  }).replace(/[\uE000\uE001]/g, "");
  return { html: restored, removed: [...removed], misplacedMarkers: misplaced };
}
