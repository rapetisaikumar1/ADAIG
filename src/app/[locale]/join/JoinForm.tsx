"use client";
import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { subdivisionsFor, countries, defaultCountry, defaultProvince, type Locale } from "@/config/site";
import { startJoin, type JoinField, type JoinState } from "./actions";
import { Icon } from "@/components/ui/Icon";

/** French display names for the country list (the submitted value stays the English name stored in the DB). */
const countryFr: Record<string, string> = { "United States": "États-Unis", Canada: "Canada", Mexico: "Mexique", "United Kingdom": "Royaume-Uni", Ireland: "Irlande", France: "France", Germany: "Allemagne", Netherlands: "Pays-Bas", Australia: "Australie", "New Zealand": "Nouvelle-Zélande", India: "Inde", Singapore: "Singapour", "South Africa": "Afrique du Sud", Other: "Autre" };

/** The tier fields the form needs (from src/lib/settings.ts on the server; admin-editable). */
export type JoinTier = { id: string; name: Record<Locale, string>; description: Record<Locale, string>; requiresVerification?: boolean };

/** Membership application form: captures details only. No prices or payment; the ADAIG team (point of contact) follows up.
 * Tiers and the directory opt-in default come from the server page as props (admin-editable settings). */
export function JoinForm({ locale, tiers, directoryOptInDefault, initialTier, signedIn, defaults }: { locale: Locale; tiers: JoinTier[]; directoryOptInDefault: boolean; initialTier: string; signedIn: boolean; defaults: { first?: string; last?: string; org?: string } }) {
  const t = useTranslations("join");
  const [tier, setTier] = useState(initialTier);
  const [country, setCountry] = useState(defaultCountry); const [prov, setProv] = useState(defaultProvince);
  const subs = subdivisionsFor(country); const isUS = country === "United States";
  const [state, action, pending] = useActionState<JoinState, FormData>(startJoin, {});
  const tt = tiers.find((x) => x.id === tier)!;
  // React 19 resets uncontrolled fields after a form action; submit via a transition instead so a server-side
  // validation error keeps everything the applicant typed. (Without JS the plain form action still works.)
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error && !pending) errRef.current?.focus(); }, [state, pending]);
  // Field-level errors: the server names the field; mark it invalid and tie the message to it (A1-14).
  const bad = (id: JoinField) => state.field === id;
  const desc = (id: JoinField, ...ids: (string | false)[]) => [bad(id) && `${id}-err`, ...ids].filter(Boolean).join(" ") || undefined;
  const fieldErr = (id: JoinField) => bad(id) ? <span className="error-msg" id={`${id}-err`}>{state.error}</span> : null;
  const fcls = (...ids: JoinField[]) => `field${ids.some(bad) ? " error" : ""}`;
  return (
    <div className="container layout-aside join-layout">
      <div>
        <ol className="steps" aria-label={t("progress")}>
          <li className="done">{t("tier")}</li>
          <li aria-current="step">{t("details")}</li>
          <li>{t("confirmation")}</li>
        </ol>
        {/* Mobile/tablet: the sidebar stacks under the long form, so show a compact "What happens next" up front instead. */}
        <section className="join-next-m" aria-labelledby="next-m-h">
          <h2 id="next-m-h">{t("nextTitle")}</h2>
          <ol className="join-next-steps">
            <li><b>{t("next1Title")}</b><span>{t("next1")}</span></li>
            <li><b>{t("next2Title")}</b><span>{t("next2")}</span></li>
            <li><b>{t("next3Title")}</b><span>{t("next3")}</span></li>
          </ol>
          <p className="small muted join-next-help">{t("questions")} <a href={`/${locale}/contact?topic=membership`}>{t("contactUs")}</a></p>
        </section>
        <form action={action} onSubmit={submit} aria-labelledby="dh" className="join-form">
          <input type="hidden" name="locale" value={locale} />
          <h2 id="dh">{t("yourDetails")}</h2>
          <p className="muted join-required">{t("allRequired")}</p>
          {/* Hidden while submitting, so the alert mounts again with the result and a repeated error is announced again. */}
          {state.error && !pending && <div className="alert alert-danger" role="alert" tabIndex={-1} ref={errRef} id="join-err"><Icon name="x-circle" /><div>{state.field ? <a href={`#${state.field}`}>{state.error}</a> : state.error}</div></div>}

          <fieldset className="fieldset join-sec"><legend>{t("secMembership")}</legend>
            <div className={fcls("tier")}><label htmlFor="tier">{t("tierLabel")}</label>
              <select id="tier" name="tier" value={tier} onChange={(e) => setTier(e.target.value)} aria-invalid={bad("tier") || undefined} aria-describedby={desc("tier", "tier-hint")}>{tiers.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}</select>
              <span className="hint" id="tier-hint">{tt.description[locale]} <a href={`/${locale}/membership`}>{t("compareTiers")}</a></span>
              {fieldErr("tier")}
            </div>
          </fieldset>

          <fieldset className="fieldset join-sec"><legend>{t("secAbout")}</legend>
            <div className="form-grid join-pair">
              <div className={fcls("fn")}><label htmlFor="fn">{t("first")}</label><input id="fn" type="text" name="firstName" required maxLength={100} defaultValue={defaults.first} autoComplete="given-name" aria-invalid={bad("fn") || undefined} aria-describedby={desc("fn")} />{fieldErr("fn")}</div>
              <div className={fcls("ln")}><label htmlFor="ln">{t("last")}</label><input id="ln" type="text" name="lastName" required maxLength={100} defaultValue={defaults.last} autoComplete="family-name" aria-invalid={bad("ln") || undefined} aria-describedby={desc("ln")} />{fieldErr("ln")}</div>
            </div>
            <div className={fcls("org")}><label htmlFor="org">{t("org")}</label><input id="org" type="text" name="organisation" required maxLength={150} defaultValue={defaults.org} autoComplete="organization" aria-invalid={bad("org") || undefined} aria-describedby={desc("org", "org-hint")} /><span className="hint" id="org-hint">{t("orgErr")}</span>{fieldErr("org")}</div>
            <div className="form-grid join-pair">
              <div className={fcls("co")}><label htmlFor="co">{t("country")}</label><select id="co" name="country" value={country} autoComplete="country-name" aria-invalid={bad("co") || undefined} aria-describedby={desc("co")} onChange={(e) => { setCountry(e.target.value); setProv(""); }}>{countries.map((c) => <option key={c} value={c}>{locale === "fr" ? countryFr[c] ?? c : c}</option>)}</select>{fieldErr("co")}</div>
              {subs && <div className={fcls("pr")}><label htmlFor="pr">{isUS ? t("state") : t("province")}</label><select id="pr" name="province" required value={prov} aria-invalid={bad("pr") || undefined} aria-describedby={desc("pr")} onChange={(e) => setProv(e.target.value)}><option value="">{t("choose")}</option>{subs.map((p) => <option key={p.code} value={p.code}>{locale === "fr" ? p.nameFr : p.name}</option>)}</select>{fieldErr("pr")}</div>}
            </div>
          </fieldset>

          {!signedIn && (
            <fieldset className="fieldset join-sec"><legend>{t("secAccount")}</legend>
              <p className="hint join-sec-intro">{t("accountHint")}</p>
              <div className={fcls("em")}><label htmlFor="em">{t("email")}</label><input id="em" name="email" type="email" required maxLength={254} autoComplete="email" aria-invalid={bad("em") || undefined} aria-describedby={desc("em", "em-hint")} /><span className="hint" id="em-hint">{t("emailHint")}</span>{fieldErr("em")}</div>
              <div className={fcls("pw")}><label htmlFor="pw">{t("password")}</label><input id="pw" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" aria-invalid={bad("pw") || undefined} aria-describedby={desc("pw", "pw-hint")} /><span className="hint" id="pw-hint">{t("passwordHint")}</span>{fieldErr("pw")}</div>
            </fieldset>
          )}

          {/* Kept mounted (hidden + disabled) when another tier is chosen, so switching tiers back and forth keeps what was typed (F1-6).
              A disabled fieldset is neither validated nor submitted. */}
          <fieldset className="fieldset join-sec" hidden={!tt.requiresVerification} disabled={!tt.requiresVerification}><legend>{t("eligibility")}</legend>
            <div className={fcls("inst")}><label htmlFor="inst">{t("institution")}</label><input id="inst" type="text" name="institution" required maxLength={150} aria-invalid={bad("inst") || undefined} aria-describedby={desc("inst")} />{fieldErr("inst")}</div>
            <label className="check"><input id="attest" type="checkbox" name="eligibilityAttest" required aria-invalid={bad("attest") || undefined} aria-describedby={desc("attest", "verify-hint")} /> <span>{t("attest")}</span></label>
            <span className="hint join-check-hint" id="verify-hint">{t("verifyHint")}</span>
            {bad("attest") && <span className="error-msg join-check-hint" id="attest-err">{state.error}</span>}
          </fieldset>

          <fieldset className="fieldset join-sec"><legend>{t("prefs")} <span className="join-optional">{t("optional")}</span></legend>
            <div className="join-checks">
              <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={directoryOptInDefault} /> <span>{t("dir")}</span></label>
              <label className="check"><input type="checkbox" name="marketingOptIn" /> <span>{t("mkt")}</span></label>
            </div>
          </fieldset>

          <div className="form-actions join-actions">
            <button className="btn btn-accent" disabled={pending} aria-busy={pending || undefined}>{pending ? t("submitting") : t("submit")}</button>
            <a href={`/${locale}/membership`} className="btn btn-ghost">{t("back")}</a>
          </div>
          <p className="small muted join-nocharge"><Icon name="info" size={18} />{t("noPayment")}</p>
        </form>
      </div>
      <aside aria-labelledby="next-h" className="join-aside"><div className="card sticky-side join-next">
        <h3 id="next-h">{t("nextTitle")}</h3>
        <div className="join-next-tier"><span className="muted small">{t("tierLabel")}</span><b>{tt.name[locale]}</b></div>
        <ol className="join-next-steps">
          <li><b>{t("next1Title")}</b><span>{t("next1")}</span></li>
          <li><b>{t("next2Title")}</b><span>{t("next2")}</span></li>
          <li><b>{t("next3Title")}</b><span>{t("next3")}</span></li>
        </ol>
        <p className="small muted join-next-help">{t("questions")} <a href={`/${locale}/contact?topic=membership`}>{t("contactUs")}</a></p>
      </div></aside>
    </div>
  );
}
