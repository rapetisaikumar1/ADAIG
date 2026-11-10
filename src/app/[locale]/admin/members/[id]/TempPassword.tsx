"use client";
import { useActionState, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { resetPassword, type PasswordState } from "./actions";

/** Set a temporary password. The result is shown once, in this response only (nothing in the URL, history or audit log). */
export function TempPassword({ locale, uid }: { locale: string; uid: string }) {
  const t = useTranslations("adminMembers");
  const [state, action, pending] = useActionState<PasswordState, FormData>(resetPassword, {});
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  return (
    <form key={state.password ?? "form"} action={action} onSubmit={submit} className="adm-mbr-pw" aria-labelledby="pw-h">
      <input type="hidden" name="locale" value={locale} /><input type="hidden" name="uid" value={uid} />
      <h3 id="pw-h" className="adm-mbr-h3">{t("pwTitle")}</h3>
      <p className="small muted" style={{ margin: 0 }}>{t("pwHint")}</p>
      {state.error && <div className="alert alert-danger" role="alert"><div>{state.error}</div></div>}
      {state.password && (
        <div className="alert alert-success" role="status">
          <div><b>{t("pwSet")}</b>{" "}{t("pwOnce")}<code className="adm-mbr-secret">{state.password}</code></div>
        </div>
      )}
      <div className="field" style={{ margin: 0 }}><label htmlFor="pw-new">{t("pwLabel")} <span className="hint">({t("optional")})</span></label>
        <input id="pw-new" name="password" type="text" autoComplete="off" spellCheck={false} maxLength={128} aria-describedby="pw-new-h" /><span className="hint" id="pw-new-h">{t("pwFieldHint")}</span></div>
      <div><button className="btn btn-secondary btn-sm" disabled={pending}>{pending ? t("working") : t("pwButton")}</button></div>
    </form>
  );
}
