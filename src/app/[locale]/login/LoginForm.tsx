"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { login, type AuthState } from "./actions";

export type LoginLabels = { email: string; password: string; forgot: string; signIn: string };

/**
 * Sign-in form. Errors come back as action state (not a redirect), so the typed email is kept, the alert is focused and
 * announced, and the fields point to it with aria-describedby. `next` is the page to return to (validated again on the server).
 * Strings come from the server page as props (no client-side message catalog needed).
 */
export function LoginForm({ locale, next, labels, initialError, initialEmail }: { locale: string; next?: string | null; labels: LoginLabels; initialError?: string | null; initialEmail?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, initialError ? { error: initialError, email: initialEmail } : {});
  // React 19 resets uncontrolled fields after a form action; submit in a transition so a failed sign-in keeps the email.
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const errRef = useRef<HTMLDivElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state.error) return;
    errRef.current?.focus();
    if (pwRef.current) pwRef.current.value = ""; // never keep a rejected password
  }, [state]);
  const invalid = !!state.error && !state.locked;
  return (
    <>
      {state.error && <div className="alert alert-danger" role="alert" id="login-err" tabIndex={-1} ref={errRef}><div>{state.error}</div></div>}
      <form action={action} onSubmit={submit}>
        <input type="hidden" name="locale" value={locale} />
        {next && <input type="hidden" name="next" value={next} />}
        <div className="field"><label htmlFor="le">{labels.email}</label><input id="le" name="email" type="email" required maxLength={254} autoComplete="username" defaultValue={state.email ?? initialEmail} aria-invalid={invalid || undefined} aria-describedby={state.error ? "login-err" : undefined} /></div>
        <div className="field"><label htmlFor="lp">{labels.password}</label><input id="lp" ref={pwRef} name="password" type="password" required autoComplete="current-password" aria-invalid={invalid || undefined} aria-describedby={state.error ? "login-err" : undefined} /></div>
        <p className="small auth-forgot"><a href={`/${locale}/contact?topic=account`}>{labels.forgot}</a></p>
        <button className="btn btn-accent btn-block" disabled={pending} aria-busy={pending || undefined}>{labels.signIn}</button>
      </form>
    </>
  );
}
