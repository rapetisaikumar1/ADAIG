"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { requestPasswordReset, type ForgotState } from "./actions";
import { Icon } from "@/components/ui/Icon";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";

export type ForgotLabels = { email: string; submit: string; sending: string; sentTitle: string; sentBody: string };

/**
 * "Forgot your password?" form. The answer is the same "check your email" state for every valid address (no account
 * enumeration); errors (bad format, rate limit) come back as action state, keep the typed email and are focused and announced.
 * `sentBody` contains the literal "{email}" placeholder, filled in here with the address the server echoed back.
 */
export function ForgotForm({ locale, labels }: { locale: string; labels: ForgotLabels }) {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error) errRef.current?.focus(); }, [state]);
  if (state.sent) {
    return (
      <FocusOnLoad>
        <div className="alert alert-success" role="status"><Icon name="check-circle" /><div><b>{labels.sentTitle}</b> {labels.sentBody.replace("{email}", state.email ?? "")}</div></div>
      </FocusOnLoad>
    );
  }
  const bad = state.field === "email";
  return (
    <>
      {state.error && <div className="alert alert-danger" role="alert" id="forgot-err" tabIndex={-1} ref={errRef}><Icon name="x-circle" /><div>{state.error}</div></div>}
      <form action={action} onSubmit={submit}>
        <input type="hidden" name="locale" value={locale} />
        <div className="auth-hp" aria-hidden="true"><label htmlFor="fp-web">Website</label><input id="fp-web" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
        <div className={`field${bad ? " error" : ""}`}><label htmlFor="fe">{labels.email}</label><input id="fe" name="email" type="email" required maxLength={254} autoComplete="username" defaultValue={state.email} aria-invalid={bad || undefined} aria-describedby={state.error ? "forgot-err" : undefined} /></div>
        <button className="btn btn-accent btn-block" disabled={pending} aria-busy={pending || undefined}>{pending ? labels.sending : labels.submit}</button>
      </form>
    </>
  );
}
