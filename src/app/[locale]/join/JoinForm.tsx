"use client";
import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { tiers, subdivisionsFor, countries, defaultCountry, defaultProvince, directoryOptInDefault, type Locale } from "@/config/site";
import { startJoin } from "./actions";

/** French display names for the country list (the submitted value stays the English name stored in the DB). */
const countryFr: Record<string, string> = { "United States": "États-Unis", Canada: "Canada", Mexico: "Mexique", "United Kingdom": "Royaume-Uni", Ireland: "Irlande", France: "France", Germany: "Allemagne", Netherlands: "Pays-Bas", Australia: "Australie", "New Zealand": "Nouvelle-Zélande", India: "Inde", Singapore: "Singapour", "South Africa": "Afrique du Sud", Other: "Autre" };

/** Membership application form: captures details only. No prices or payment; the ADAIG team (point of contact) follows up. */
export function JoinForm({ locale, initialTier, signedIn, defaults }: { locale: Locale; initialTier: string; signedIn: boolean; defaults: { first?: string; last?: string; org?: string } }) {
  const t = useTranslations("join");
  const [tier, setTier] = useState(initialTier);
  const [country, setCountry] = useState(defaultCountry); const [prov, setProv] = useState(defaultProvince);
  const subs = subdivisionsFor(country); const isUS = country === "United States";
  const [state, action, pending] = useActionState(startJoin, {});
  const tt = tiers.find((x) => x.id === tier)!;
  // React 19 resets uncontrolled fields after a form action; submit via a transition instead so a server-side
  // validation error keeps everything the applicant typed. (Without JS the plain form action still works.)
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error) errRef.current?.focus(); }, [state]);
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
          <p className="small muted join-next-help">{t("questions")} <a href={`/${locale}/contact`}>{t("contactUs")}</a></p>
        </section>
        <form action={action} onSubmit={submit} aria-labelledby="dh" className="join-form">
          <input type="hidden" name="locale" value={locale} />
          <h2 id="dh">{t("yourDetails")}</h2>
          <p className="muted join-required">{t("allRequired")}</p>
          {state.error && <div className="alert alert-danger" role="alert" tabIndex={-1} ref={errRef}><div>{state.error}</div></div>}

          <fieldset className="join-sec"><legend>{t("secMembership")}</legend>
            <div className="field"><label htmlFor="tier">{t("tierLabel")}</label>
              <select id="tier" name="tier" value={tier} onChange={(e) => setTier(e.target.value)} aria-describedby="tier-hint">{tiers.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}</select>
              <span className="hint" id="tier-hint">{tt.description[locale]} <a href={`/${locale}/membership`}>{t("compareTiers")}</a></span>
            </div>
          </fieldset>

          <fieldset className="join-sec"><legend>{t("secAbout")}</legend>
            <div className="grid g2 join-pair">
              <div className="field"><label htmlFor="fn">{t("first")}</label><input id="fn" type="text" name="firstName" required defaultValue={defaults.first} autoComplete="given-name" /></div>
              <div className="field"><label htmlFor="ln">{t("last")}</label><input id="ln" type="text" name="lastName" required defaultValue={defaults.last} autoComplete="family-name" /></div>
            </div>
            <div className="field"><label htmlFor="org">{t("org")}</label><input id="org" type="text" name="organisation" required defaultValue={defaults.org} autoComplete="organization" aria-describedby="org-hint" /><span className="hint" id="org-hint">{t("orgErr")}</span></div>
            <div className="grid g2 join-pair">
              <div className="field"><label htmlFor="co">{t("country")}</label><select id="co" name="country" value={country} autoComplete="country-name" onChange={(e) => { setCountry(e.target.value); setProv(""); }}>{countries.map((c) => <option key={c} value={c}>{locale === "fr" ? countryFr[c] ?? c : c}</option>)}</select></div>
              {subs && <div className="field"><label htmlFor="pr">{isUS ? t("state") : t("province")}</label><select id="pr" name="province" required value={prov} onChange={(e) => setProv(e.target.value)}><option value="">{t("choose")}</option>{subs.map((p) => <option key={p.code} value={p.code}>{locale === "fr" ? p.nameFr : p.name}</option>)}</select></div>}
            </div>
          </fieldset>

          {!signedIn && (
            <fieldset className="join-sec"><legend>{t("secAccount")}</legend>
              <p className="hint join-sec-intro">{t("accountHint")}</p>
              <div className="field"><label htmlFor="em">{t("email")}</label><input id="em" name="email" type="email" required autoComplete="email" aria-describedby="em-hint" /><span className="hint" id="em-hint">{t("emailHint")}</span></div>
              <div className="field"><label htmlFor="pw">{t("password")}</label><input id="pw" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" aria-describedby="pw-hint" /><span className="hint" id="pw-hint">{t("passwordHint")}</span></div>
            </fieldset>
          )}

          {tt.requiresVerification && (
            <fieldset className="join-sec"><legend>{t("eligibility")}</legend>
              <div className="field"><label htmlFor="inst">{t("institution")}</label><input id="inst" type="text" name="institution" required /></div>
              <label className="check"><input type="checkbox" name="eligibilityAttest" required aria-describedby="verify-hint" /> <span>{t("attest")}</span></label>
              <span className="hint join-check-hint" id="verify-hint">{t("verifyHint")}</span>
            </fieldset>
          )}

          <fieldset className="join-sec"><legend>{t("prefs")} <span className="join-optional">{t("optional")}</span></legend>
            <div className="join-checks">
              <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={directoryOptInDefault} /> <span>{t("dir")}</span></label>
              <label className="check"><input type="checkbox" name="marketingOptIn" /> <span>{t("mkt")}</span></label>
            </div>
          </fieldset>

          <div className="join-actions">
            <button className="btn btn-accent" disabled={pending} aria-busy={pending || undefined}>{pending ? t("submitting") : t("submit")}</button>
            <a href={`/${locale}/membership`} className="btn btn-ghost">{t("back")}</a>
          </div>
          <p className="small muted join-nocharge">{t("noPayment")}</p>
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
        <p className="small muted join-next-help">{t("questions")} <a href={`/${locale}/contact`}>{t("contactUs")}</a></p>
      </div></aside>
    </div>
  );
}
