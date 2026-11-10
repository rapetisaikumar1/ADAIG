import { randomInt } from "crypto";
import { subdivisionsFor, locales } from "@/config/site";
import { cleanText, emailOk, normEmail, normCountry, normProvince, limits } from "@/lib/validation";

export type ProfileInput = { name: string; email: string; organisation: string | null; jobTitle: string | null; country: string; province: string | null; locale: string; directoryOptIn: boolean; marketingOptIn: boolean };
/** Error keys are adminMembers.err_* messages. */
export type ProfileError = "err_name" | "err_email" | "err_org" | "err_job" | "err_country" | "err_province" | "err_locale";

/** Optional free text: blank → null; control characters stripped; over the limit → undefined (error). */
const optional = (v: FormDataEntryValue | null, max: number): string | null | undefined => {
  if (!String(v ?? "").replace(/[\u0000-\u001f\u007f\s]/g, "")) return null;
  return cleanText(v, max) ?? undefined;
};

/** Staff-entered profile (account page and "New account"). Same rules as /join: whitelisted country/state, normalized email. */
export function parseProfile(fd: FormData): { data: ProfileInput } | { error: ProfileError } {
  const name = cleanText(fd.get("name"), limits.name); if (!name) return { error: "err_name" };
  const email = normEmail(String(fd.get("email") ?? "").replace(/[\u0000-\u001f\u007f]/g, "")); if (!emailOk(email)) return { error: "err_email" };
  const organisation = optional(fd.get("organisation"), limits.organisation); if (organisation === undefined) return { error: "err_org" };
  const jobTitle = optional(fd.get("jobTitle"), limits.jobTitle); if (jobTitle === undefined) return { error: "err_job" };
  const country = normCountry(fd.get("country")); if (!country) return { error: "err_country" };
  const rawProv = String(fd.get("province") ?? "").trim();
  // Staff may leave the state/province blank (unknown for members added offline); a value must belong to the country.
  let province: string | null = null;
  if (rawProv) { if (!subdivisionsFor(country)) return { error: "err_province" }; province = normProvince(rawProv, country); if (!province) return { error: "err_province" }; }
  const locale = String(fd.get("prefLocale") ?? ""); if (!(locales as readonly string[]).includes(locale)) return { error: "err_locale" };
  return { data: { name, email, organisation, jobTitle, country, province, locale, directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on" } };
}

/** Readable random temporary password (no look-alike characters), always accepted by checkPassword(). */
export function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const chars = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
