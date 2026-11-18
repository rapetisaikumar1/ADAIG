"use client";
import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";

/**
 * The password rules as a short checklist (round 9, presentation only): the same message, one item per sentence, joined by a
 * space, so the visible text and the field's accessible description (aria-describedby) read exactly as before.
 */
export function PwRules({ text }: { text: string }) {
  const parts = text.split(/(?<=[.!?])\s+(?=\S)/);
  return <>{parts.map((s, i) => <Fragment key={i}>{i > 0 && " "}<span className="acc-pw-rule">{s}</span></Fragment>)}</>;
}

/**
 * A password input with an accessible show/hide toggle (a real button whose accessible name says what it does: "Show password" /
 * "Hide password"). Uncontrolled, never pre-filled: passwords are never echoed back from the server.
 */
export function PasswordField({ id, name, label, error, describedBy, autoComplete = "new-password" }: {
  id: string; name: string; label: string; error?: string; describedBy?: string; autoComplete?: string;
}) {
  const t = useTranslations("adminUsers");
  const [shown, setShown] = useState(false);
  const errId = `${id}-err`;
  const desc = [error ? errId : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="acc-pw">
        <input suppressHydrationWarning id={id} name={name} type={shown ? "text" : "password"} autoComplete={autoComplete} spellCheck={false} autoCapitalize="off"
          maxLength={128} required aria-invalid={error ? true : undefined} aria-describedby={desc} />
        <button suppressHydrationWarning type="button" className="acc-pw-toggle" aria-controls={id} aria-label={shown ? t("pwHideLabel") : t("pwShowLabel")} onClick={() => setShown((v) => !v)}>
          <Icon name="eye" size={16} /><span aria-hidden="true">{shown ? t("pwHide") : t("pwShow")}</span>
        </button>
      </div>
      {/* The field's error is the one announcement (role=alert): the form shows no second copy of the same text. */}
      {error && <span className="error-msg" id={errId} role="alert">{error}</span>}
    </div>
  );
}
