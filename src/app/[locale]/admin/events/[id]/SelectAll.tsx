"use client";
/** "Select all" for the bulk attendance form: ticks every row checkbox that belongs to the form (form="<formId>"). */
export function SelectAll({ formId, label }: { formId: string; label: string }) {
  return (
    <label className="check adm-selall">
      <input type="checkbox" onChange={(ev) => {
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form="${formId}"]`).forEach((c) => { c.checked = ev.currentTarget.checked; });
      }} />
      <span>{label}</span>
    </label>
  );
}
