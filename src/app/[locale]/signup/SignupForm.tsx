"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { signup, type AuthState } from "../login/actions";
import { Icon } from "@/components/ui/Icon";

export type SignupLabels = { name: string; email: string; password: string; passwordHint: string; mkt: string; create: string };

/**
 * Free guest account form. Server validation errors come back as action state: the name, email and opt-in are kept (never the
 * password), the alert is focused and announced, and the field at fault is marked invalid and linked to the message.
 * `next` is the page to return to after the account is created (validated again on the server).
 */
export function SignupForm({ locale, next, labels }: { locale: string; next?: string | null; labels: SignupLabels }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, {});
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const errRef = useRef<HTMLDivElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state.error) return;
    errRef.current?.focus();
    if (pwRef.current) pwRef.current.value = "";
  }, [state]);
  const bad = (f: NonNullable<AuthState["field"]>) => state.field === f;
  const desc = (f: NonNullable<AuthState["field"]>, extra?: string) => [bad(f) ? "signup-err" : "", extra ?? ""].filter(Boolean).join(" ") || undefined;
  return (
    <>
      {state.error && <div className="alert alert-danger" role="alert" id="signup-err" tabIndex={-1} ref={errRef}><Icon name="x-circle" /><div>{state.error}</div></div>}
      <form action={action} onSubmit={submit}>
        <input type="hidden" name="locale" value={locale} />
        {next && <input type="hidden" name="next" value={next} />}
        <div className={`field${bad("name") ? " error" : ""}`}><label htmlFor="sn">{labels.name}</label><input type="text" id="sn" name="name" required maxLength={100} autoComplete="name" defaultValue={state.name} aria-invalid={bad("name") || undefined} aria-describedby={desc("name")} /></div>
        <div className={`field${bad("email") ? " error" : ""}`}><label htmlFor="se">{labels.email}</label><input id="se" name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={state.email} aria-invalid={bad("email") || undefined} aria-describedby={desc("email")} /></div>
        <div className={`field${bad("password") ? " error" : ""}`}><label htmlFor="sp">{labels.password}</label><input id="sp" ref={pwRef} name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" aria-describedby={desc("password", "sp-hint")} aria-invalid={bad("password") || undefined} /><span className="hint" id="sp-hint">{labels.passwordHint}</span></div>
        <label className="check auth-check"><input type="checkbox" name="marketingOptIn" defaultChecked={state.marketingOptIn} /> {labels.mkt}</label>
        <button className="btn btn-accent btn-block" disabled={pending} aria-busy={pending || undefined}>{labels.create}</button>
      </form>
    </>
  );
}
