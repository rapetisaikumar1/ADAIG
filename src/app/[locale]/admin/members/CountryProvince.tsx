"use client";
import { useState } from "react";
import { countries, subdivisionsFor } from "@/config/site";
import { countryLabel } from "./countryNames";

/**
 * Country + state/province for the staff profile forms. The second list only offers the subdivisions of the chosen country
 * (US states, DC and territories, or Canadian provinces) and is disabled for other countries, so a mismatch can't be submitted.
 * The server still validates the pair (src/app/[locale]/admin/members/_validate.ts).
 */
export function CountryProvince({ idp, locale, country: initialCountry, province: initialProvince, labels }: {
  idp: string; locale: string; country: string; province: string;
  labels: { country: string; province: string; provinceHint: string; provinceNone: string };
}) {
  const [country, setCountry] = useState(initialCountry);
  const [province, setProvince] = useState(initialProvince);
  const subs = subdivisionsFor(country);
  const list = countries.includes(initialCountry) ? countries : [initialCountry, ...countries]; // a legacy value stays selectable
  const value = subs?.some((p) => p.code === province) ? province : "";
  return (
    <div className="adm-form-grid">
      <div className="field"><label htmlFor={`${idp}-country`}>{labels.country}</label>
        <select id={`${idp}-country`} name="country" value={country} onChange={(e) => { setCountry(e.target.value); setProvince(""); }}>
          {list.map((c) => <option key={c} value={c}>{countryLabel(c, locale)}</option>)}
        </select></div>
      <div className="field"><label htmlFor={`${idp}-prov`}>{labels.province}</label>
        <select id={`${idp}-prov`} name="province" value={value} onChange={(e) => setProvince(e.target.value)} disabled={!subs} aria-describedby={`${idp}-prov-h`}>
          <option value="">{subs ? "—" : labels.provinceNone}</option>
          {subs?.map((p) => <option key={p.code} value={p.code}>{locale === "fr" ? p.nameFr : p.name} ({p.code})</option>)}
        </select>
        <span className="hint" id={`${idp}-prov-h`}>{labels.provinceHint}</span></div>
    </div>
  );
}
