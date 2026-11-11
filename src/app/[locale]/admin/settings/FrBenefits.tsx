"use client";
import { useEffect, useRef } from "react";

/** One benefit per non-blank line, normalised like the server (saveTier → lines() → cleanText) so lines compare equal. */
const benefitLines = (v: string) =>
  v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);

/**
 * French benefit lines to submit with the English lines `next`, given the stored pairs (`en[i]` ↔ `fr[i]`).
 * 1. A line whose English text matches a stored line keeps that line's French (wherever it moved to).
 * 2. A remaining line at the SAME position as a remaining stored line is treated as an edit of it and keeps its French.
 * 3. Anything else is a new line: its English text is stored as the French (French visitors see English for it, as for any
 *    untranslated text). Removed lines drop their French line. (Index pairing alone was wrong: removing one benefit and adding
 *    another keeps the count but shifts every French line onto the wrong English one.)
 */
export function frBenefitsFor(en: string[], fr: string[], next: string[]): string[] {
  const used = new Set<number>();
  const out: (string | null)[] = next.map((line) => {
    const j = en.findIndex((o, i) => !used.has(i) && o === line);
    if (j < 0) return null;
    used.add(j); return fr[j] ?? line;
  });
  return out.map((v, i) => {
    if (v !== null) return v;
    if (i < en.length && !used.has(i)) { used.add(i); return fr[i] ?? next[i]; } // edited in place
    return next[i]; // new line
  });
}

/**
 * Hidden "benefitsFr" field of a tier form (Admin → Settings). French is not offered in the admin since round 6b, but the
 * stored French benefits are kept and the action still requires as many French lines as English ones: this keeps the hidden
 * value in step with the English textarea (`benefitsEn` in the same form) so adding or removing a benefit still saves.
 * Without JavaScript the stored French lines are sent unchanged (saving works as long as the number of lines is unchanged).
 */
export function FrBenefits({ en, fr }: { en: string[]; fr: string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current; const form = input?.form; if (!input || !form) return;
    const field = form.elements.namedItem("benefitsEn");
    if (!(field instanceof HTMLTextAreaElement)) return;
    const sync = () => { input.value = frBenefitsFor(en, fr, benefitLines(field.value)).join("\n"); };
    sync(); // the browser may have restored an edited English value (back/forward)
    form.addEventListener("input", sync);
    return () => form.removeEventListener("input", sync);
  }, [en, fr]);
  return <input ref={ref} type="hidden" name="benefitsFr" defaultValue={fr.join("\n")} />;
}
