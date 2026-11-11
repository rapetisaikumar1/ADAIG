"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createAdminUser, type UserFormState } from "../actions";
import { PasswordField } from "../PasswordField";
import { Icon } from "@/components/ui/Icon";

type Field = NonNullable<UserFormState["field"]>;
const FIELD_IDS: Record<Field, string> = { name: "u-name", email: "u-email", password: "u-pw", confirm: "u-pw2", role: "u-role" };
const FIELD_LABELS: Record<Field, "f_name" | "f_email" | "f_password" | "f_confirm" | "f_role"> = { name: "f_name", email: "f_email", password: "f_password", confirm: "f_confirm", role: "f_role" };

export type RoleChoice = { id: string; name: string; description: string | null; super: boolean };

/**
 * Create user (SPEC_R7 §5.1/§5.2): name, email, password + confirm, role. Direct creation — no invitation, no email. On success the
 * action redirects to the new user's page. On an error the typed name, email and role are kept (never the passwords) and the
 * offending field is marked and described.
 */
export function NewUserForm({ locale, roles, cancelHref }: { locale: string; roles: RoleChoice[]; cancelHref: string }) {
  const t = useTranslations("adminUsers");
  const [state, action, pending] = useActionState<UserFormState, FormData>(createAdminUser, {});
  // Submit through a transition so a validation error keeps what was typed (React 19 resets form fields after a form action).
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    // Passwords are never kept after an attempt: clear them before the round trip.
    for (const n of ["password", "confirm"]) { const el = form.elements.namedItem(n); if (el instanceof HTMLInputElement) el.value = ""; }
    startTransition(() => action(fd));
  };
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state.error) return;
    // Move focus to the field at fault (its message is linked by aria-describedby); otherwise to the form error.
    const el = state.field ? document.getElementById(FIELD_IDS[state.field]) : null;
    if (el) el.focus(); else errRef.current?.focus();
  }, [state]);
  const err = (f: UserFormState["field"]) => (state.field === f ? state.error : undefined);
  const fieldCls = (f: UserFormState["field"]) => `field${err(f) ? " error" : ""}`;
  const describe = (f: UserFormState["field"], id: string, hint?: string) => [err(f) ? `${id}-err` : null, hint].filter(Boolean).join(" ") || undefined;

  return (
    <form action={action} onSubmit={submit} className="adm-sheet acc-form" aria-labelledby="h-new-user" noValidate data-testid="new-user-form">
      <input type="hidden" name="locale" value={locale} />
      {/* Each error is shown once. A field error is announced under its field (role=alert there) and this summary only points to
          that field; an error that concerns no field (session, permission) is announced here. */}
      {state.error && (state.field
        ? <div className="alert alert-danger adm-form-error" tabIndex={-1} ref={errRef} data-testid="form-error-summary">
            <Icon name="alert" size={20} /><div>{t("errSummary")} <a href={`#${FIELD_IDS[state.field]}`}>{t(FIELD_LABELS[state.field])}</a></div></div>
        : <div className="alert alert-danger adm-form-error" role="alert" tabIndex={-1} ref={errRef}><Icon name="alert" size={20} /><div>{state.error}</div></div>)}

      <div className="settings-section">
        <header><h2 id="h-new-user">{t("detailsTitle")}</h2><p>{t("newDetailsHint")}</p></header>
        <div className="adm-fields"><div className="adm-form-grid">
          <div className={fieldCls("name")}>
            <label htmlFor="u-name">{t("f_name")}</label>
            <input id="u-name" name="name" type="text" autoComplete="off" required maxLength={100} defaultValue={state.name ?? ""} key={`n-${state.name ?? ""}`}
              aria-invalid={err("name") ? true : undefined} aria-describedby={describe("name", "u-name")} />
            {err("name") && <span className="error-msg" id="u-name-err" role="alert">{err("name")}</span>}
          </div>
          <div className={fieldCls("email")}>
            <label htmlFor="u-email">{t("f_email")}</label>
            <input id="u-email" name="email" type="email" autoComplete="off" spellCheck={false} autoCapitalize="off" required maxLength={254} defaultValue={state.email ?? ""} key={`e-${state.email ?? ""}`}
              aria-invalid={err("email") ? true : undefined} aria-describedby={describe("email", "u-email", err("email") ? undefined : "u-email-h")} />
            {err("email") && <span className="error-msg" id="u-email-err" role="alert">{err("email")}</span>}
            {/* the hint restates the rule: hidden while the field shows its error (no third copy) */}
            {!err("email") && <span className="hint" id="u-email-h">{t("emailHint")}</span>}
          </div>
        </div></div>
      </div>

      <div className="settings-section">
        <header><h2>{t("pwSectionTitle")}</h2><p>{t("pwSectionHint")}</p></header>
        <div className="adm-fields">
          <div className="adm-form-grid">
            <PasswordField id="u-pw" name="password" label={t("f_password")} error={err("password")} describedBy="u-pw-h" />
            <PasswordField id="u-pw2" name="confirm" label={t("f_confirm")} error={err("confirm")} />
          </div>
          <p className="hint acc-pw-rules" id="u-pw-h"><span>{t("pwHint")}</span></p>
        </div>
      </div>

      <div className="settings-section">
        <header><h2>{t("roleTitle")}</h2><p>{t("roleHint")}</p></header>
        <div className="adm-fields">
          <div className="adm-form-grid"><div className={fieldCls("role")}>
            <label htmlFor="u-role">{t("f_role")}</label>
            <select id="u-role" name="roleId" required defaultValue={state.roleId ?? ""} key={`r-${state.roleId ?? ""}`}
              aria-invalid={err("role") ? true : undefined} aria-describedby={describe("role", "u-role", "u-role-h")}>
              <option value="" disabled>{t("chooseRole")}</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {err("role") && <span className="error-msg" id="u-role-err" role="alert">{err("role")}</span>}
            <span className="hint" id="u-role-h">{t("roleSelectHint")}</span>
          </div></div>
          {roles.some((r) => r.description) && (
            <dl className="acc-role-help">
              {roles.filter((r) => r.description).map((r) => <div key={r.id}><dt>{r.name}</dt><dd>{r.description}</dd></div>)}
            </dl>
          )}
        </div>
      </div>

      <div className="save-row adm-sheet-foot">
        <a className="btn btn-ghost" href={cancelHref}>{t("cancel")}</a>
        <button className="btn btn-accent" disabled={pending} aria-busy={pending || undefined}>{pending ? t("working") : t("createButton")}</button>
      </div>
    </form>
  );
}
