"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createAccount, type NewAccountState } from "./actions";
import { ProfileFields, TierOptions, type TierChoice } from "../_fields";

/** "New account" form. On success the generated password is shown once, here only. */
export function NewAccountForm({ locale, tiers, minDay, directoryDefault }: { locale: string; tiers: TierChoice[]; minDay: string; directoryDefault: boolean }) {
  const t = useTranslations("adminMembers"); const ta = useTranslations("admin");
  const [state, action, pending] = useActionState<NewAccountState, FormData>(createAccount, {});
  // Submit through a transition so a validation error keeps what staff typed (React 19 resets form fields after an action).
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error || state.created) statusRef.current?.focus(); }, [state]);

  if (state.created) {
    const c = state.created;
    return (
      <div className="adm-sheet adm-created">
        <div className="alert alert-success" role="status" tabIndex={-1} ref={statusRef}>
          <div><b>{t("createdTitle", { name: c.name })}</b>{c.email}
            {c.password && <>{" · "}{t("pwOnce")}<code className="adm-secret">{c.password}</code></>}</div>
        </div>
        {c.membershipError && <div className="alert alert-danger" role="alert"><div>{c.membershipError}</div></div>}
        <div className="adm-actions"><a className="btn btn-primary btn-sm" href={`/${locale}/admin/members/${c.id}`}>{t("openAccount")}</a><a className="btn btn-secondary btn-sm" href={`/${locale}/admin/members/new`}>{t("createAnother")}</a></div>
      </div>
    );
  }
  return (
    <form action={action} onSubmit={submit} className="adm-sheet" aria-label={t("newAccount")}>
      <input type="hidden" name="locale" value={locale} />
      {state.error && <div className="alert alert-danger adm-form-error" role="alert" tabIndex={-1} ref={statusRef}><div>{state.error}</div></div>}
      <div className="settings-section"><header><h2>{t("profileTitle")}</h2><p>{t("profileNewHint")}</p></header>
        <div className="adm-fields"><ProfileFields t={(k) => t(k as "f_name")} locale={locale} idp="n" d={{ locale, directoryOptIn: directoryDefault }} /></div></div>
      {/* No role choice (round 7, D1): the account is a guest, and a member once the membership below is added. */}
      <div className="settings-section"><header><h2>{t("accessTitle")}</h2></header>
        <div className="adm-fields"><div className="adm-form-grid">
          <div className="field"><label htmlFor="n-pw">{t("pwLabelNew")} <span className="optional">({t("optional")})</span></label><input id="n-pw" name="password" type="text" autoComplete="off" spellCheck={false} maxLength={128} aria-describedby="n-pw-h" /><span className="hint" id="n-pw-h">{t("pwFieldHint")}</span></div>
        </div></div></div>
      <div className="settings-section"><header><h2>{t("grantTitle")} <span className="optional">({t("optional")})</span></h2><p>{t("grantHint")}</p></header>
        <div className="adm-fields"><div className="adm-form-grid">
          <div className="field"><label htmlFor="n-tier">{ta("tier")}</label><select id="n-tier" name="tier" defaultValue=""><option value="">{t("noMembershipOpt")}</option><TierOptions list={tiers} /></select></div>
          <div className="field"><label htmlFor="n-renew">{t("renewsOn")} <span className="optional">({t("defaultOneYear")})</span></label><input id="n-renew" name="renewsOn" type="date" min={minDay} /></div>
        </div></div></div>
      <div className="save-row adm-sheet-foot">
        <a className="btn btn-ghost" href={`/${locale}/admin/members`}>{t("cancel")}</a>
        <button className="btn btn-accent" disabled={pending} aria-busy={pending || undefined}>{pending ? t("working") : t("createButton")}</button>
      </div>
    </form>
  );
}
