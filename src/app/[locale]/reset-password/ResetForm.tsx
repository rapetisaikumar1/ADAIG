"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { resetPassword, type ResetState } from "../forgot-password/actions";
import { Icon } from "@/components/ui/Icon";

export type ResetLabels = { password: string; hint: string; confirm: string; submit: string; saving: string; invalidTitle: string; invalidBody: string; requestNew: string };

/**
 * Set-new-password form (round 8, EMAIL_SPEC §3.4). The token travels in a hidden field. Policy errors come back as action
 * state (focused and announced; the password fields are cleared). An invalid, used or expired token turns the form into the
 * invalid state with a link to request a new one. Success redirects to /login?reset=done.
 */
export function ResetForm({ locale, token, labels, initialInvalid }: { locale: string; token: string; labels: ResetLabels; initialInvalid?: boolean }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, initialInvalid ? { invalid: true } : {});
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const errRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.error && !state.invalid) return;
    errRef.current?.focus();
    formRef.current?.querySelectorAll<HTMLInputElement>("input[type=password]").forEach((i) => { i.value = ""; });
  }, [state]);
  if (state.invalid) {
    return (
      <>
        <div className="alert alert-danger" role="alert" tabIndex={-1} ref={initialInvalid ? undefined : errRef}><Icon name="x-circle" /><div><b>{labels.invalidTitle}</b> {labels.invalidBody}</div></div>
        <a className="btn btn-primary btn-block" href={`/${locale}/forgot-password`}>{labels.requestNew}</a>
      </>
    );
  }
  const bad = (f: NonNullable<ResetState["field"]>) => state.field === f;
  const desc = (f: NonNullable<ResetState["field"]>, extra?: string) => [bad(f) ? "reset-err" : "", extra ?? ""].filter(Boolean).join(" ") || undefined;
  return (
    <>
      {state.error && <div className="alert alert-danger" role="alert" id="reset-err" tabIndex={-1} ref={errRef}><Icon name="x-circle" /><div>{state.error}</div></div>}
      <form action={action} onSubmit={submit} ref={formRef}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <div className={`field${bad("password") ? " error" : ""}`}><label htmlFor="rp">{labels.password}</label><input id="rp" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" aria-invalid={bad("password") || undefined} aria-describedby={desc("password", "rp-hint")} /><span className="hint" id="rp-hint">{labels.hint}</span></div>
        <div className={`field${bad("confirm") ? " error" : ""}`}><label htmlFor="rc">{labels.confirm}</label><input id="rc" name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" aria-invalid={bad("confirm") || undefined} aria-describedby={desc("confirm")} /></div>
        <button className="btn btn-accent btn-block" disabled={pending} aria-busy={pending || undefined}>{pending ? labels.saving : labels.submit}</button>
      </form>
    </>
  );
}
