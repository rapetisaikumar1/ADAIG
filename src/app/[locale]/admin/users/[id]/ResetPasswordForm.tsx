"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { resetAdminUserPassword, type PasswordResetState } from "../actions";
import { PasswordField } from "../PasswordField";

/**
 * Reset another admin's password (SPEC_R7 §5.2): new + confirm, policy-checked on the server; the user's sessions end. The
 * password is never echoed: both fields are cleared on
 * every submit, before the round trip, and a notice is shown on success.
 */
export function ResetPasswordForm({ locale, uid }: { locale: string; uid: string }) {
  const t = useTranslations("adminUsers");
  const [state, action, pending] = useActionState<PasswordResetState, FormData>(resetAdminUserPassword, {});
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    for (const n of ["password", "confirm"]) { const el = form.elements.namedItem(n); if (el instanceof HTMLInputElement) el.value = ""; }
    startTransition(() => action(fd));
  };
  const noteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.field) document.getElementById(state.field === "confirm" ? "rp-pw2" : "rp-pw")?.focus();
    else if (state.error || state.ok) noteRef.current?.focus();
  }, [state]);
  const err = (f: PasswordResetState["field"]) => (state.field === f ? state.error : undefined);
  return (
    <form action={action} onSubmit={submit} className="acc-reset" aria-labelledby="h-password" noValidate data-testid="reset-password-form">
      <input type="hidden" name="locale" value={locale} /><input type="hidden" name="uid" value={uid} />
      {state.ok && <div className="alert alert-success" role="status" tabIndex={-1} ref={noteRef}><div>{t("msg_pwReset")}</div></div>}
      {/* A field error is shown once, under its field (role=alert there); only an error with no field is shown here. */}
      {state.error && !state.field && <div className="alert alert-danger" role="alert" tabIndex={-1} ref={noteRef}><div>{state.error}</div></div>}
      <div className="adm-form-grid">
        <PasswordField id="rp-pw" name="password" label={t("pwNew")} error={err("password")} describedBy="rp-pw-h" />
        <PasswordField id="rp-pw2" name="confirm" label={t("pwConfirm")} error={err("confirm")} />
      </div>
      <p className="hint acc-pw-rules" id="rp-pw-h">{t("pwHint")}</p>
      <div className="save-row">
        <button className="btn btn-accent" disabled={pending} aria-busy={pending || undefined}>{pending ? t("working") : t("pwButton")}</button>
      </div>
    </form>
  );
}
