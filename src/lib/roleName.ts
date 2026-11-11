// Admin role names (round-7 fix S5 / SEC L-4). Pure module (no "@/" imports): used by admin/roles/actions.ts and tests.
// A role name is shown in role selects, badges and the Users list, so it must not be able to pass for another role
// (above all the system role "Super Admin"): NFKC-normalised, no invisible/format characters, one alphabet, and unique on a
// "skeleton" that folds case, spacing, separators, accents and common Cyrillic/Greek/small-capital lookalikes.

export type RoleNameCheck = { ok: true; name: string } | { ok: false; reason: "length" | "chars" };

// Invisible or format characters: \p{Cf} (zero-width space/joiners, bidi controls, soft hyphen, BOM…), every default-ignorable
// code point (Hangul fillers, variation selectors…), private-use, unassigned and surrogate code points, and blank-looking symbols.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cn}\p{Cs}⠀ㅤﾠᅟᅠ]/u;
const CONTROL = /[\p{Cc}]/u;

/** Script of a letter for the mixed-alphabet rule (only the scripts that are commonly confused with each other). */
function scriptOf(ch: string): "latin" | "cyrillic" | "greek" | null {
  if (/\p{Script=Latin}/u.test(ch)) return "latin";
  if (/\p{Script=Cyrillic}/u.test(ch)) return "cyrillic";
  if (/\p{Script=Greek}/u.test(ch)) return "greek";
  return null;
}

/**
 * Clean and validate a typed role name. NFKC (fullwidth/maths letters → plain; NBSP → space), control characters and runs of
 * whitespace collapsed to one space, trimmed; then refused when it holds an invisible/format character or letters from more
 * than one of Latin/Cyrillic/Greek. Length is counted in code points after cleaning.
 */
export function cleanRoleName(raw: unknown, min: number, max: number): RoleNameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "length" };
  const nfkc = raw.slice(0, 1000).normalize("NFKC");
  if (INVISIBLE.test(nfkc)) return { ok: false, reason: "chars" };
  const name = nfkc.replace(CONTROL, " ").replace(/\s+/gu, " ").trim();
  const len = [...name].length;
  if (len < min || len > max) return { ok: false, reason: "length" };
  const scripts = new Set<string>();
  for (const ch of name) { const s = /\p{L}/u.test(ch) ? scriptOf(ch) : null; if (s) scripts.add(s); }
  if (scripts.size > 1) return { ok: false, reason: "chars" };
  return { ok: true, name };
}

// Lookalikes folded onto Latin. Upper-case forms first (some differ from their lower-case look: Greek Η looks like H, η like n).
const UPPER: Record<string, string> = {
  // Cyrillic
  "А": "A", "В": "B", "Е": "E", "Ѐ": "E", "Ё": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X",
  "Ѕ": "S", "І": "I", "Ї": "I", "Ј": "J", "Ү": "Y", "Ԁ": "D", "Ԛ": "Q", "Ԝ": "W", "Һ": "H", "Ӏ": "I", "З": "3", "Ь": "b",
  // Greek
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
};
const LOWER: Record<string, string> = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ѐ": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "х": "x",
  "у": "y", "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ү": "y", "ԁ": "d", "ԛ": "q", "ԝ": "w", "һ": "h", "ӏ": "l", "ɡ": "g", "п": "n",
  "г": "r", "ь": "b", "з": "3",
  // Greek
  "α": "a", "β": "b", "γ": "y", "ε": "e", "ζ": "z", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
  "ϲ": "c", "ϳ": "j",
  // Latin small capitals and other look-alikes NFKC keeps
  "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m", "ɴ": "n",
  "ᴏ": "o", "ᴘ": "p", "ʀ": "r", "ꜱ": "s", "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z", "ı": "i", "ȷ": "j", "ł": "l",
  // digits and symbols that pass for letters
  "0": "o", "1": "l", "|": "l", "!": "l", "$": "s", "5": "s", "@": "a",
};

/**
 * Comparison key: two names with the same skeleton are treated as the same name. NFKC, lookalikes folded onto Latin, lower-case,
 * accents/combining marks removed, i/l/1 and "rn"/"m", "vv"/"w" merged, every non-letter/digit (spaces, hyphens, dots…) dropped.
 */
export function roleNameSkeleton(name: string): string {
  let s = name.normalize("NFKC");
  s = [...s].map((c) => UPPER[c] ?? c).join("").toLowerCase();
  s = [...s].map((c) => LOWER[c] ?? c).join("");
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = s.replace(/[^\p{L}\p{N}]/gu, "");
  return s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/[il]/g, "l");
}

/** Case-insensitive comparison of two cleaned names (exact match, used for the "already has this name" message). */
export const sameRoleName = (a: string, b: string) => a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase();
