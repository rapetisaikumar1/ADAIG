"use client";
import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { MODULES, ACTIONS, MODULE_ACTIONS, canPerm, type Action, type Module, type Permissions } from "@/lib/permissions";
import type { RoleFormState } from "./actions";

type RoleAction = (s: RoleFormState, fd: FormData) => Promise<RoleFormState>;
const key = (m: Module, a: Action) => `${m}:${a}`;

/**
 * Mirror of the server normalisation (permissions.ts normalizePermissions): ticking Create, Edit or Delete also ticks View;
 * unticking View clears the whole row. The server re-normalises and re-checks everything; this only keeps the screen honest.
 */
function toggle(sel: Set<string>, m: Module, a: Action, on: boolean): Set<string> {
  const next = new Set(sel);
  if (on) { next.add(key(m, a)); if (a !== "view") next.add(key(m, "view")); }
  else if (a === "view") for (const x of MODULE_ACTIONS[m]) next.delete(key(m, x));
  else next.delete(key(m, a));
  return next;
}

/**
 * Role name, description and the permission matrix (Admin → Roles → new / one role).
 * - `action` absent → read-only (Super Admin, your own role, a role with permissions you don't hold, or no roles.edit):
 *   name and description as text (VIS m7: no inputs, no edit hints), every checkbox disabled, "Full" as a chip, no save.
 * - Cells the actor's own role doesn't have are disabled (no escalation; the server checks again).
 * - Desktop: a table (modules × View/Create/Edit/Delete + Full access); phones (CSS): one card per module with labelled toggles.
 */
export function RoleForm({ locale, action, role, initial, actor, cancelHref, submitLabel }: {
  locale: string; action?: RoleAction; role?: { id: string; v: string; name: string; description: string };
  initial: string[]; actor: Permissions; cancelHref: string; submitLabel: string;
}) {
  const t = useTranslations("adminRoles");
  const readOnly = !action;
  const [state, run, pending] = useActionState<RoleFormState, FormData>(action ?? (async (s) => s), {});
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  // VIS p6: on a new role the "no permissions" warning waits until the matrix is used (or a submit is refused for it).
  const [touched, setTouched] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error) errRef.current?.focus(); }, [state]);
  // Submit through a transition so a validation error keeps what was typed (React 19 resets uncontrolled fields after an action).
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => run(fd)); };

  const holds = (m: Module, a: Action) => canPerm(actor, m, a);
  const fieldErr = (f: RoleFormState["field"]) => !!state.error && state.field === f;
  const modName = (m: Module) => t(`mod_${m}`);
  const actName = (a: Action) => t(`act_${a}`);
  const anyLocked = !readOnly && MODULES.some((m) => MODULE_ACTIONS[m].some((a) => !holds(m, a)));
  const showEmptyWarn = !readOnly && sel.size === 0 && (touched || !!role || fieldErr("perms"));

  const body = (
    <>
      {locale && !readOnly && <input type="hidden" name="locale" value={locale} />}
      {role && !readOnly && <><input type="hidden" name="id" value={role.id} /><input type="hidden" name="v" value={role.v} /></>}
      {state.error && <div className="alert alert-danger adm-form-error" id="rl-err" role="alert" tabIndex={-1} ref={errRef}><div>{state.error}</div></div>}

      <section className="settings-section" aria-labelledby="h-rl-details">
        <header><h2 id="h-rl-details">{t("detailsTitle")}</h2>{!readOnly && <p>{t("detailsHint")}</p>}</header>
        {readOnly ? (
          <div className="adm-fields">
            <dl className="adm-ro-dl rl-ro-dl">
              <div className="is-wide"><dt>{t("f_name")}</dt><dd>{role?.name}</dd></div>
              <div className="is-wide"><dt>{t("f_description")}</dt>{role?.description ? <dd>{role.description}</dd> : <dd className="is-empty">{t("noDescription")}</dd>}</div>
            </dl>
          </div>
        ) : <div className="adm-fields">
          <div className={`field${fieldErr("name") ? " error" : ""}`}>
            <label htmlFor="r-name">{t("f_name")}</label>
            <input id="r-name" name={readOnly ? undefined : "name"} type="text" required={!readOnly} readOnly={readOnly} minLength={2} maxLength={60} autoComplete="off"
              defaultValue={state.name ?? role?.name ?? ""} aria-invalid={fieldErr("name") || undefined} aria-describedby={fieldErr("name") ? "rl-err" : undefined} />
          </div>
          <div className={`field${fieldErr("description") ? " error" : ""}`}>
            <label htmlFor="r-desc">{t("f_description")} {!readOnly && <span className="optional">({t("descHint")})</span>}</label>
            <textarea id="r-desc" name={readOnly ? undefined : "description"} rows={3} maxLength={300} readOnly={readOnly}
              defaultValue={state.description ?? role?.description ?? ""} aria-invalid={fieldErr("description") || undefined} aria-describedby={fieldErr("description") ? "rl-err" : undefined} />
          </div>
        </div>}
      </section>

      <section className="settings-section is-wide rl-perms" aria-labelledby="h-rl-perms" id="permissions">
        <header><h2 id="h-rl-perms">{t("permsTitle")}</h2><p id="rl-perms-hint">{readOnly ? t("permsHintRO") : t("permsHint")}</p></header>
        <div className="adm-fields">
          <div className={`rl-matrix-wrap${fieldErr("perms") ? " has-error" : ""}`} role="group" aria-labelledby="h-rl-perms" aria-describedby={fieldErr("perms") ? "rl-perms-hint rl-err" : "rl-perms-hint"}>
            <table className={`rl-matrix${readOnly ? " is-readonly" : ""}`}>
              <caption className="sr-only">{t("matrixCaption")}</caption>
              <thead><tr>
                <th scope="col" className="rl-col-mod">{t("colModule")}</th>
                {ACTIONS.map((a) => <th scope="col" key={a} className="rl-col-act">{actName(a)}</th>)}
                <th scope="col" className="rl-col-full">{t("full")}</th>
              </tr></thead>
              <tbody>
                {MODULES.map((m) => {
                  const acts = MODULE_ACTIONS[m];
                  const on = acts.filter((a) => sel.has(key(m, a)));
                  const full = on.length === acts.length;
                  const canFull = !readOnly && acts.every((a) => holds(m, a));
                  return (
                    <tr key={m} className={on.length ? "is-on" : undefined}>
                      <th scope="row" className="rl-mod">
                        <span className="rl-mod-name">{modName(m)}</span>
                        <span className="rl-mod-hint">{t(`modHint_${m}`)}</span>
                      </th>
                      {ACTIONS.map((a) => {
                        if (!acts.includes(a)) return (
                          <td key={a} className="rl-na"><span aria-hidden="true">—</span><span className="sr-only">{t("cellLabel", { module: modName(m), action: actName(a) })}: {t("na")}</span></td>
                        );
                        const locked = !readOnly && !holds(m, a);
                        const id = `perm-${m}-${a}`;
                        return (
                          <td key={a} className={`rl-cell${locked ? " is-locked" : ""}`}>
                            <label className="rl-check" htmlFor={id} title={locked ? t("notYours") : undefined}>
                              <input type="checkbox" id={id} name={readOnly ? undefined : "perm"} value={key(m, a)}
                                checked={sel.has(key(m, a))} disabled={readOnly || locked}
                                aria-describedby={locked ? "rl-locked-legend" : undefined}
                                onChange={(e) => { const v = e.currentTarget.checked; setTouched(true); setSel((s) => toggle(s, m, a, v)); }} />
                              <span className="sr-only">{t("cellLabel", { module: modName(m), action: actName(a) })}</span>
                              <span className="rl-act-txt" aria-hidden="true">{actName(a)}</span>
                              {locked && <Icon name="lock" size={14} />}
                            </label>
                          </td>
                        );
                      })}
                      <td className="rl-full">
                        {readOnly ? (full
                          ? <span className="status status-available rl-full-ro">{t("lvl_full")}</span>
                          : <span className="rl-full-ro is-off"><span aria-hidden="true">—</span><span className="sr-only">{t("cellLabel", { module: modName(m), action: t("full") })}: {t("lvl_none")}</span></span>
                        ) : <label className="switch rl-switch" htmlFor={`full-${m}`} title={!readOnly && !canFull ? t("notYours") : undefined}>
                          <input type="checkbox" role="switch" id={`full-${m}`} checked={full} disabled={!canFull}
                            aria-describedby={!readOnly && !canFull ? "rl-locked-legend" : undefined}
                            onChange={(e) => { const v = e.currentTarget.checked; setTouched(true); setSel((s) => { const n = new Set(s); for (const a of acts) { if (v) n.add(key(m, a)); else n.delete(key(m, a)); } return n; }); }} />
                          <span className="sr-only">{t("cellLabel", { module: modName(m), action: t("full") })}</span>
                          <span className="rl-full-txt" aria-hidden="true">{t("full")}</span>
                        </label>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {anyLocked && <p className="hint rl-legend" id="rl-locked-legend"><Icon name="lock" size={14} />{t("notYoursLegend")}</p>}
          <div className="rl-empty-warn" role="status">
            {showEmptyWarn && <div className="alert alert-warning"><Icon name="alert" size={20} /><div>{t("emptyWarn")}</div></div>}
            {readOnly && sel.size === 0 && <div className="alert alert-info"><Icon name="info" size={20} /><div>{t("noPerms")}</div></div>}
          </div>
          {!readOnly && (
            <div className="save-row">
              <a className="btn btn-ghost" href={cancelHref}>{t("cancel")}</a>
              <button className="btn btn-accent" disabled={pending} aria-busy={pending || undefined}>{pending ? t("working") : submitLabel}</button>
            </div>
          )}
        </div>
      </section>
    </>
  );

  return readOnly
    ? <div className="adm-sheet rl-form">{body}</div>
    : <form action={run} onSubmit={submit} className="adm-sheet rl-form" aria-label={submitLabel} noValidate>{body}</form>;
}
