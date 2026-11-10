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
  const legend = { font: "700 var(--fs-xs) var(--font-body)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--slate-500)", margin: "8px 0 12px" } as const;

  if (state.created) {
    const c = state.created;
    return (
      <div className="card adm-form">
        <div className="alert alert-success" role="status" tabIndex={-1} ref={statusRef}>
          <div><b>{t("createdTitle", { name: c.name })}</b>{c.email}
            {c.password && <>{" · "}{t("pwOnce")}<code className="adm-mbr-secret">{c.password}</code></>}</div>
        </div>
        {c.membershipError && <div className="alert alert-danger" role="alert"><div>{c.membershipError}</div></div>}
        <div className="adm-actions"><a className="btn btn-accent btn-sm" href={`/${locale}/admin/members/${c.id}`}>{t("openAccount")}</a><a className="btn btn-secondary btn-sm" href={`/${locale}/admin/members/new`}>{t("createAnother")}</a></div>
      </div>
    );
  }
  return (
    <form action={action} onSubmit={submit} className="card adm-form" aria-label={t("newAccount")}>
      <input type="hidden" name="locale" value={locale} />
      <p className="small muted" style={{ margin: 0 }}>{t("newHint")}</p>
      {state.error && <div className="alert alert-danger" role="alert" tabIndex={-1} ref={statusRef}><div>{state.error}</div></div>}
      <h3 style={legend}>{t("profileTitle")}</h3>
      <ProfileFields t={(k) => t(k as "f_name")} locale={locale} idp="n" d={{ locale, directoryOptIn: directoryDefault }} />
      <h3 style={legend}>{t("accessTitle")}</h3>
      <div className="grid g2" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor="n-role">{ta("role")}</label><select id="n-role" name="role" defaultValue="guest" aria-describedby="n-role-h">{(["guest", "member", "admin"] as const).map((r) => <option key={r} value={r}>{ta(`role_${r}`)}</option>)}</select><span className="hint" id="n-role-h">{t("roleHint")}</span></div>
        <div className="field"><label htmlFor="n-pw">{t("pwLabel")} <span className="hint">({t("optional")})</span></label><input id="n-pw" name="password" type="text" autoComplete="off" spellCheck={false} maxLength={128} aria-describedby="n-pw-h" /><span className="hint" id="n-pw-h">{t("pwFieldHint")}</span></div>
      </div>
      <h3 style={legend}>{t("grantTitle")} <span className="hint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>({t("optional")})</span></h3>
      <div className="grid g2" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor="n-tier">{ta("tier")}</label><select id="n-tier" name="tier" defaultValue=""><option value="">{t("noMembershipOpt")}</option><TierOptions list={tiers} /></select></div>
        <div className="field"><label htmlFor="n-renew">{t("renewsOn")} <span className="hint">({t("defaultOneYear")})</span></label><input id="n-renew" name="renewsOn" type="date" min={minDay} /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t("grantHint")}</p>
      <div className="adm-form-foot">
        <a className="small" href={`/${locale}/admin/members`}>← {ta("membersTitle")}</a>
        <button className="btn btn-accent" disabled={pending}>{pending ? t("working") : t("createButton")}</button>
      </div>
    </form>
  );
}
