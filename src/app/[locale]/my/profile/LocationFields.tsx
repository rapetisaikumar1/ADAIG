"use client";
import { useState } from "react";
import { countries, subdivisionsFor } from "@/config/site";
import { countryLabel } from "@/app/[locale]/admin/members/countryNames";

type Err = { id: string; text: string } | null;
/**
 * Country + state/province on Profile & privacy (round 7: collected at /join and editable by staff, now visible and correctable by
 * the member). Same lists as /join and Admin → Members: the state list appears only for the United States and Canada and only
 * offers that country's subdivisions. The state is optional here (an unrelated save is never blocked); the server re-validates.
 */
export function LocationFields({ locale, country: initialCountry, province: initialProvince, labels, countryErr, provinceErr }: {
  locale: string; country: string; province: string;
  labels: { country: string; state: string; province: string; blank: string };
  countryErr: Err; provinceErr: Err;
}) {
  const [country, setCountry] = useState(initialCountry);
  const [province, setProvince] = useState(initialProvince);
  const subs = subdivisionsFor(country);
  const list = countries.includes(initialCountry) ? countries : [initialCountry, ...countries]; // a legacy value stays visible
  const value = subs?.some((p) => p.code === province) ? province : "";
  return (
    <>
      <div className={`field${countryErr ? " error" : ""}`}><label htmlFor="pf-country">{labels.country}</label>
        <select id="pf-country" name="country" value={country} autoComplete="country-name" onChange={(e) => { setCountry(e.target.value); setProvince(""); }}
          aria-invalid={!!countryErr || undefined} aria-describedby={countryErr?.id}>
          {list.map((c) => <option key={c} value={c}>{countryLabel(c, locale)}</option>)}
        </select>
        {countryErr && <span className="error-msg" id={countryErr.id}>{countryErr.text}</span>}
      </div>
      {subs ? (
        <div className={`field${provinceErr ? " error" : ""}`}><label htmlFor="pf-prov">{country === "United States" ? labels.state : labels.province}</label>
          <select id="pf-prov" name="province" value={value} autoComplete="address-level1" onChange={(e) => setProvince(e.target.value)}
            aria-invalid={!!provinceErr || undefined} aria-describedby={provinceErr?.id}>
            <option value="">{labels.blank}</option>
            {subs.map((p) => <option key={p.code} value={p.code}>{locale === "fr" ? p.nameFr : p.name}</option>)}
          </select>
          {provinceErr && <span className="error-msg" id={provinceErr.id}>{provinceErr.text}</span>}
        </div>
      ) : <input type="hidden" name="province" value="" />}
    </>
  );
}
