"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { tiers, currencies, multiCurrency, subdivisionsFor, countries, defaultCountry, taxFor, fmt2, defaultProvince, directoryOptInDefault, type Currency, type Locale } from "@/config/site";
import { startJoin } from "./actions";

export function JoinForm({ locale, initialTier, initialCur, signedIn, mock, defaults }: { locale: Locale; initialTier: string; initialCur: Currency; signedIn: boolean; mock: boolean; defaults: { first?: string; last?: string; org?: string } }) {
  const t = useTranslations("join");
  const [tier, setTier] = useState(initialTier); const [cur, setCur] = useState<Currency>(initialCur);
  const [country, setCountry] = useState(defaultCountry); const [prov, setProv] = useState(defaultProvince);
  const subs = subdivisionsFor(country); const isUS = country === "United States";
  const [state, action, pending] = useActionState(startJoin, {});
  const tt = tiers.find((x) => x.id === tier)!; const amt = tt.price[cur]; const tax = taxFor(country, prov, amt);
  return (
    <div className="container layout-aside">
      <div>
        <ol className="steps" aria-label="Progress"><li className="done">{t("tier")}</li><li aria-current="step">{t("details")}</li><li>{t("payment")}</li></ol>
        <form action={action} aria-labelledby="dh">
          <input type="hidden" name="locale" value={locale} />
          <h2 id="dh" style={{ fontSize: "var(--fs-2xl)" }}>{t("yourDetails")}</h2>
          {state.error && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><div>{state.error}</div></div>}
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="tier">{t("tierLabel")}</label><select id="tier" name="tier" value={tier} onChange={(e) => setTier(e.target.value)}>{tiers.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}</select></div>
            {multiCurrency ? <div className="field"><label htmlFor="cur">{t("currency")}</label><select id="cur" name="currency" value={cur} onChange={(e) => setCur(e.target.value as Currency)}>{currencies.map((c) => <option key={c}>{c}</option>)}</select></div>
              : <input type="hidden" name="currency" value={cur} />}
          </div>
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="fn">{t("first")}</label><input id="fn" type="text" name="firstName" required defaultValue={defaults.first} autoComplete="given-name" /></div>
            <div className="field"><label htmlFor="ln">{t("last")}</label><input id="ln" type="text" name="lastName" required defaultValue={defaults.last} autoComplete="family-name" /></div>
          </div>
          {!signedIn && (
            <>
              <div className="field"><label htmlFor="em">{t("email")}</label><input id="em" name="email" type="email" required autoComplete="email" /><span className="hint">{t("emailHint")}</span></div>
              <div className="field"><label htmlFor="pw">{t("password")}</label><input id="pw" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /><span className="hint">{t("passwordHint")}</span></div>
            </>
          )}
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="co">{t("country")}</label><select id="co" name="country" value={country} onChange={(e) => { setCountry(e.target.value); setProv(""); }}>{countries.map((c) => <option key={c}>{c}</option>)}</select></div>
            {subs && <div className="field"><label htmlFor="pr">{isUS ? t("state") : t("province")}</label><select id="pr" name="province" required value={prov} onChange={(e) => setProv(e.target.value)}><option value="">{t("choose")}</option>{subs.map((p) => <option key={p.code} value={p.code}>{locale === "fr" ? p.nameFr : p.name}</option>)}</select></div>}
          </div>
          <div className="field"><label htmlFor="org">{t("org")}</label><input id="org" type="text" name="organisation" required defaultValue={defaults.org} aria-describedby="org-hint" /><span className="hint" id="org-hint">{t("orgErr")}</span></div>
          {tt.requiresVerification && (
            <fieldset className="field" style={{ border: 0, padding: 0 }}><legend className="label">{t("eligibility")}</legend>
              <div className="field"><label htmlFor="inst">{t("institution")}</label><input id="inst" type="text" name="institution" required /></div>
              <label className="check"><input type="checkbox" name="eligibilityAttest" required /> {t("attest")}</label>
              <span className="hint">{t("verifyHint")}</span>
            </fieldset>
          )}
          <fieldset className="field" style={{ border: 0, padding: 0 }}><legend className="label">{t("prefs")}</legend>
            <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={directoryOptInDefault} /> {t("dir")}</label>
            <label className="check"><input type="checkbox" name="marketingOptIn" /> {t("mkt")}</label>
            <label className="check"><input type="checkbox" name="autoRenew" defaultChecked /> {t("renew")}</label>
          </fieldset>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><a href={`/${locale}/membership`} className="btn btn-ghost">{t("back")}</a><button className="btn btn-accent" disabled={pending}>{t("continue")}</button></div>
        </form>
      </div>
      <aside><div className="card sticky-side"><h3>{t("summary")}</h3>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>{tt.name[locale]} · {t("oneYear")}</span><b>{fmt2(amt, cur, locale)}</b></div>
        {tax.amount > 0 && <div style={{ display: "flex", justifyContent: "space-between" }} className="muted"><span>{t("tax")} ({tax.label})</span><span>{fmt2(tax.amount, cur, locale)}</span></div>}
        <hr style={{ border: 0, borderTop: "1px solid var(--c-border)", width: "100%" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}><b>{t("total")}</b><b>{fmt2(amt + tax.amount, cur, locale)}</b></div>
        <p className="small muted">{t("pci")}</p>
        {mock && <p className="small"><span className="badge badge-amber">Mock</span> {t("mock")}</p>}
      </div></aside>
    </div>
  );
}
