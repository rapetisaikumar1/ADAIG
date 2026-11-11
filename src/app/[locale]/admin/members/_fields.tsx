/**
 * Profile fields shared by the account page (server form) and "New account" (client form). No hooks, so it renders in both;
 * labels come in as a translate function (adminMembers namespace).
 */
import { CountryProvince } from "./CountryProvince";

type T = (key: string) => string;
export type ProfileDefaults = { name?: string; email?: string; organisation?: string | null; jobTitle?: string | null; country?: string; province?: string | null; locale?: string; directoryOptIn?: boolean; marketingOptIn?: boolean };

export function ProfileFields({ t, locale, d, idp }: { t: T; locale: string; d: ProfileDefaults; idp: string }) {
  return (
    <>
      <div className="adm-form-grid">
        <div className="field"><label htmlFor={`${idp}-name`}>{t("f_name")}</label><input type="text" id={`${idp}-name`} name="name" defaultValue={d.name} required maxLength={100} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${idp}-email`}>{t("f_email")}</label><input type="email" id={`${idp}-email`} name="email" defaultValue={d.email} required maxLength={254} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${idp}-org`}>{t("f_org")} <span className="optional">({t("optional")})</span></label><input type="text" id={`${idp}-org`} name="organisation" defaultValue={d.organisation ?? ""} maxLength={150} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${idp}-job`}>{t("f_job")} <span className="optional">({t("optional")})</span></label><input type="text" id={`${idp}-job`} name="jobTitle" defaultValue={d.jobTitle ?? ""} maxLength={100} autoComplete="off" /></div>
      </div>
      <CountryProvince idp={idp} locale={locale} country={d.country ?? "United States"} province={d.province ?? ""}
        labels={{ country: t("f_country"), province: t("f_province"), provinceHint: t("f_provinceHint"), provinceNone: t("f_provinceNone") }} />
      {/* No "Preferred language" choice (client, round 6b: French is not offered). parseProfile requires prefLocale, so the
          account's stored value is re-submitted unchanged ("New account": the page locale, the select's old default). */}
      <input type="hidden" name="prefLocale" value={d.locale ?? locale} />
      <div className="adm-checks">
        <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={!!d.directoryOptIn} /> <span>{t("f_directory")}</span></label>
        <label className="check"><input type="checkbox" name="marketingOptIn" defaultChecked={!!d.marketingOptIn} /> <span>{t("f_marketing")}</span></label>
      </div>
    </>
  );
}

/** Tier choices (id + localized name), built on the server from the admin-editable tiers (src/lib/settings.ts) and passed down. */
export type TierChoice = { id: string; name: string };
export const TierOptions = ({ list }: { list: TierChoice[] }) => <>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</>;
