"use client";
import { useEffect, useRef } from "react";

/**
 * Presentation-only helper for the event forms (New event, Event details) — FIXLIST D6 / QA-FA-6 / QA-PORTALS-3.
 * The server action keeps its own validation and contract; this only makes a refused submission painless:
 *  1. Before submitting, it checks the same basics the server checks (required text not blank, a start date, numbers within the
 *     inputs' min/max) and, if something is wrong, marks each field (aria-invalid + its .error-msg via aria-describedby), focuses
 *     the first one and keeps the form open with everything typed.
 *  2. On a valid submit it keeps a draft of the typed values for this tab (sessionStorage); if the server refuses it (any of the
 *     form's refusal notices), the values are put back and focus goes to the notice. Any other result clears the draft.
 * Privacy (FIXLIST D9): drafts are scoped to the signed-in admin's id (another id's draft is ignored and removed), expire after
 * 30 minutes, and every sign-out button clears all admin drafts (ClearAdminDrafts in AppShell's SignOutButton).
 * Without JavaScript the browser's own required/min/max validation still applies.
 */
type Msgs = { required: string; date: string; range: string };
/** sessionStorage key prefix shared with ClearAdminDrafts. */
export const DRAFT_PREFIX = "adm-draft:";
const DRAFT_TTL = 30 * 60e3;

export function EventFormHelper({ storageKey, userId, restore, msgs, noticeId }: { storageKey: string; userId: string; restore: boolean; msgs: Msgs; noticeId?: string }) {
  const key = `${DRAFT_PREFIX}${storageKey}`;
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    form.noValidate = true;
    const fields = () => [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name], textarea[name], select[name]")]
      .filter((el) => el.type !== "hidden" && !el.disabled);
    const errEl = (el: Element) => (el.id ? form.querySelector<HTMLElement>(`#${CSS.escape(el.id)}-err`) : null);
    const clear = (el: HTMLElement) => {
      el.removeAttribute("aria-invalid");
      const e = errEl(el); if (!e) return;
      e.hidden = true; e.textContent = "";
      el.setAttribute("aria-describedby", (el.getAttribute("aria-describedby") ?? "").split(" ").filter((x) => x && x !== e.id).join(" "));
      if (!el.getAttribute("aria-describedby")) el.removeAttribute("aria-describedby");
    };
    const mark = (el: HTMLElement, text: string) => {
      el.setAttribute("aria-invalid", "true");
      const e = errEl(el); if (!e) return;
      e.textContent = text; e.hidden = false;
      const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      if (!ids.includes(e.id)) el.setAttribute("aria-describedby", [e.id, ...ids].join(" "));
    };
    const problem = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | null => {
      const v = el.value.trim();
      if (el.required && !v) return el.type === "datetime-local" ? msgs.date : msgs.required;
      if (el instanceof HTMLInputElement && el.type === "number" && v) {
        const n = Number(v), min = el.min === "" ? -Infinity : Number(el.min), max = el.max === "" ? Infinity : Number(el.max);
        if (!Number.isFinite(n) || n < min || n > max) return msgs.range.replace("{min}", el.min || "0").replace("{max}", el.max || "∞");
      }
      if (el instanceof HTMLInputElement && el.type === "datetime-local" && v && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return msgs.date;
      return null;
    };
    const onSubmit = (ev: SubmitEvent) => {
      let first: HTMLElement | null = null;
      for (const el of fields()) { clear(el); const p = problem(el); if (p) { mark(el, p); first ??= el; } }
      if (first) { ev.preventDefault(); first.focus(); return; }
      try {
        const data: Record<string, string | boolean> = {};
        for (const el of fields()) data[el.name] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
        sessionStorage.setItem(key, JSON.stringify({ uid: userId, at: Date.now(), data }));
      } catch { /* storage unavailable: nothing to restore later */ }
    };
    const onInput = (ev: Event) => { const el = ev.target as HTMLElement; if (el.getAttribute("aria-invalid")) clear(el); };
    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", onInput);
    // After a refused submission: put the typed values back; otherwise forget them.
    try {
      const raw = sessionStorage.getItem(key);
      const saved = raw ? JSON.parse(raw) as { uid?: string; at?: number; data?: Record<string, string | boolean> } : null;
      const valid = !!saved?.data && saved.uid === userId && typeof saved.at === "number" && Date.now() - saved.at < DRAFT_TTL;
      if (saved && (!valid || !restore)) sessionStorage.removeItem(key);
      if (restore && valid) {
        const data = saved!.data!;
        for (const el of fields()) if (el.name in data) {
          if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = !!data[el.name];
          else el.value = String(data[el.name]);
          el.dispatchEvent(new Event("change", { bubbles: true })); // e.g. dependent selects
        }
      }
    } catch { /* ignore */ }
    if (restore) {
      const n = noticeId ? document.getElementById(noticeId) : null;
      if (n) { n.tabIndex = -1; n.focus(); } else fields()[0]?.focus();
    }
    return () => { form.removeEventListener("submit", onSubmit); form.removeEventListener("input", onInput); };
  }, [key, userId, restore, msgs, noticeId]);
  return <span ref={ref} hidden />;
}
