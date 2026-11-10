/**
 * Profile fields shared by the account page (server form) and "New account" (client form). No hooks, so it renders in both;
 * labels come in as a translate function (adminMembers namespace).
 */
import { countries, usStates, caProvinces } from "@/config/site";

type T = (key: string) => string;
export type ProfileDefaults = { name?: string; email?: string; organisation?: string | null; jobTitle?: string | null; country?: string; province?: string | null; locale?: string; directoryOptIn?: boolean; marketingOptIn?: boolean };

export function ProfileFields({ t, locale, d, idp }: { t: T; locale: string; d: ProfileDefaults; idp: string }) {
  const country = d.country ?? "United States";
  const countryList = countries.includes(country) ? countries : [country, ...countries]; // legacy value stays selectable
  const sub = (p: { code: string; name: string; nameFr: string }) => <option key={p.code} value={p.code}>{locale === "fr" ? p.nameFr : p.name} ({p.code})</option>;
  return (
    <>
      <div className="grid g2" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor={`${idp}-name`}>{t("f_name")}</label><input type="text" id={`${idp}-name`} name="name" defaultValue={d.name} required maxLength={100} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${idp}-email`}>{t("f_email")}</label><input type="email" id={`${idp}-email`} name="email" defaultValue={d.email} required maxLength={254} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${idp}-org`}>{t("f_org")} <span className="hint">({t("optional")})</span></label><input type="text" id={`${idp}-org`} name="organisation" defaultValue={d.organisation ?? ""} maxLength={150} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${idp}-job`}>{t("f_job")} <span className="hint">({t("optional")})</span></label><input type="text" id={`${idp}-job`} name="jobTitle" defaultValue={d.jobTitle ?? ""} maxLength={100} autoComplete="off" /></div>
      </div>
      <div className="grid g2" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor={`${idp}-country`}>{t("f_country")}</label><select id={`${idp}-country`} name="country" defaultValue={country}>{countryList.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor={`${idp}-prov`}>{t("f_province")}</label>
          <select id={`${idp}-prov`} name="province" defaultValue={d.province ?? ""} aria-describedby={`${idp}-prov-h`}>
            <option value="">—</option>
            <optgroup label="United States">{usStates.map(sub)}</optgroup>
            <optgroup label="Canada">{caProvinces.map(sub)}</optgroup>
          </select>
          <span className="hint" id={`${idp}-prov-h`}>{t("f_provinceHint")}</span></div>
      </div>
      <div className="grid g2" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor={`${idp}-lang`}>{t("f_language")}</label><select id={`${idp}-lang`} name="prefLocale" defaultValue={d.locale ?? locale}><option value="en" lang="en">English</option><option value="fr" lang="fr">Français</option></select></div>
      </div>
      <div className="adm-mbr-checks">
        <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={!!d.directoryOptIn} /> <span>{t("f_directory")}</span></label>
        <label className="check"><input type="checkbox" name="marketingOptIn" defaultChecked={!!d.marketingOptIn} /> <span>{t("f_marketing")}</span></label>
      </div>
    </>
  );
}

/** Tier choices (id + localized name), built on the server from the admin-editable tiers (src/lib/settings.ts) and passed down. */
export type TierChoice = { id: string; name: string };
export const TierOptions = ({ list }: { list: TierChoice[] }) => <>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</>;
