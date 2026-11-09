/**
 * ADAIG portal configuration — SINGLE SOURCE OF TRUTH for decisions the founder has not made yet.
 * Edit locales, currencies, membership tiers (names, prices, benefits) and sales tax here.
 * Prices are placeholders copied from the design prototype. Amounts are in minor units (cents).
 */
export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/**
 * Currencies. ADAIG HQ is in the USA and prices are USD only (Bhanu, Nov 2026).
 * - knownCurrencies: every currency the app can DISPLAY (historic CAD payments stay shown in CAD).
 * - currencies: the currencies offered for NEW orders. Add "CAD" back here to re-enable the switch;
 *   selectors appear automatically when more than one is listed.
 */
export const knownCurrencies = ["USD", "CAD"] as const;
export type Currency = (typeof knownCurrencies)[number];
export const currencies: readonly Currency[] = ["USD"];
export const defaultCurrency: Currency = "USD";
export const multiCurrency = currencies.length > 1;
export const currencyPrefix: Record<Currency, string> = { USD: "US$", CAD: "CA$" };

type L = Record<Locale, string>;
export type Tier = {
  id: string;
  name: L;
  description: L;
  price: Record<Currency, number>; // per year, cents (CAD kept only so the currency can be re-enabled)
  benefits: L[];
  featured?: boolean;
  requiresVerification?: boolean;
};

export const tiers: Tier[] = [
  {
    id: "student",
    name: { en: "Student", fr: "Étudiant" },
    description: { en: "For full-time students and career changers.", fr: "Pour les étudiants à temps plein et les personnes en reconversion." },
    price: { CAD: 4000, USD: 3000 },
    benefits: [
      { en: "Community & webinars", fr: "Communauté et webinaires" },
      { en: "Learning discounts", fr: "Rabais sur la formation" },
      { en: "Mentorship (Phase 3)", fr: "Mentorat (phase 3)" },
      { en: "Eligibility verification", fr: "Vérification d’admissibilité" },
    ],
    requiresVerification: true,
  },
  {
    id: "professional",
    name: { en: "Professional", fr: "Professionnel" },
    description: { en: "For practitioners in data, records, privacy and AI governance.", fr: "Pour les praticiens de la gouvernance des données, des documents, de la vie privée et de l’IA." },
    price: { CAD: 19500, USD: 14500 },
    benefits: [
      { en: "Everything in Student", fr: "Tout ce qu’offre Étudiant" },
      { en: "Full resource library", fr: "Bibliothèque complète" },
      { en: "Member exam pricing", fr: "Tarif membre aux examens" },
      { en: "CPE tracking & badges", fr: "Suivi des FPC et badges" },
      { en: "Member directory", fr: "Répertoire des membres" },
    ],
    featured: true,
  },
  {
    id: "public-sector",
    name: { en: "Public sector / NFP", fr: "Secteur public / OBNL" },
    description: { en: "For government, non-profit and higher-ed staff.", fr: "Pour le personnel gouvernemental, des OBNL et de l’enseignement supérieur." },
    price: { CAD: 11000, USD: 8000 },
    benefits: [
      { en: "Professional benefits", fr: "Avantages Professionnel" },
      { en: "Sector working group", fr: "Groupe de travail sectoriel" },
    ],
  },
  {
    id: "retired",
    name: { en: "Retired / Associate", fr: "Retraité / Associé" },
    description: { en: "Stay connected after active practice.", fr: "Restez en contact après la pratique active." },
    price: { CAD: 7500, USD: 5500 },
    benefits: [
      { en: "Community & webinars", fr: "Communauté et webinaires" },
      { en: "Library (read)", fr: "Bibliothèque (lecture)" },
      { en: "Voting (Phase 3)", fr: "Vote (phase 3)" },
    ],
  },
];

export type Subdivision = { code: string; name: string; nameFr: string };
/** US states + DC + territories (USPS codes). */
export const usStates: Subdivision[] = [
  { code: "AL", name: "Alabama", nameFr: "Alabama" },
  { code: "AK", name: "Alaska", nameFr: "Alaska" },
  { code: "AZ", name: "Arizona", nameFr: "Arizona" },
  { code: "AR", name: "Arkansas", nameFr: "Arkansas" },
  { code: "CA", name: "California", nameFr: "Californie" },
  { code: "CO", name: "Colorado", nameFr: "Colorado" },
  { code: "CT", name: "Connecticut", nameFr: "Connecticut" },
  { code: "DE", name: "Delaware", nameFr: "Delaware" },
  { code: "DC", name: "District of Columbia", nameFr: "District de Columbia" },
  { code: "FL", name: "Florida", nameFr: "Floride" },
  { code: "GA", name: "Georgia", nameFr: "Géorgie" },
  { code: "HI", name: "Hawaii", nameFr: "Hawaï" },
  { code: "ID", name: "Idaho", nameFr: "Idaho" },
  { code: "IL", name: "Illinois", nameFr: "Illinois" },
  { code: "IN", name: "Indiana", nameFr: "Indiana" },
  { code: "IA", name: "Iowa", nameFr: "Iowa" },
  { code: "KS", name: "Kansas", nameFr: "Kansas" },
  { code: "KY", name: "Kentucky", nameFr: "Kentucky" },
  { code: "LA", name: "Louisiana", nameFr: "Louisiane" },
  { code: "ME", name: "Maine", nameFr: "Maine" },
  { code: "MD", name: "Maryland", nameFr: "Maryland" },
  { code: "MA", name: "Massachusetts", nameFr: "Massachusetts" },
  { code: "MI", name: "Michigan", nameFr: "Michigan" },
  { code: "MN", name: "Minnesota", nameFr: "Minnesota" },
  { code: "MS", name: "Mississippi", nameFr: "Mississippi" },
  { code: "MO", name: "Missouri", nameFr: "Missouri" },
  { code: "MT", name: "Montana", nameFr: "Montana" },
  { code: "NE", name: "Nebraska", nameFr: "Nebraska" },
  { code: "NV", name: "Nevada", nameFr: "Nevada" },
  { code: "NH", name: "New Hampshire", nameFr: "New Hampshire" },
  { code: "NJ", name: "New Jersey", nameFr: "New Jersey" },
  { code: "NM", name: "New Mexico", nameFr: "Nouveau-Mexique" },
  { code: "NY", name: "New York", nameFr: "New York" },
  { code: "NC", name: "North Carolina", nameFr: "Caroline du Nord" },
  { code: "ND", name: "North Dakota", nameFr: "Dakota du Nord" },
  { code: "OH", name: "Ohio", nameFr: "Ohio" },
  { code: "OK", name: "Oklahoma", nameFr: "Oklahoma" },
  { code: "OR", name: "Oregon", nameFr: "Oregon" },
  { code: "PA", name: "Pennsylvania", nameFr: "Pennsylvanie" },
  { code: "RI", name: "Rhode Island", nameFr: "Rhode Island" },
  { code: "SC", name: "South Carolina", nameFr: "Caroline du Sud" },
  { code: "SD", name: "South Dakota", nameFr: "Dakota du Sud" },
  { code: "TN", name: "Tennessee", nameFr: "Tennessee" },
  { code: "TX", name: "Texas", nameFr: "Texas" },
  { code: "UT", name: "Utah", nameFr: "Utah" },
  { code: "VT", name: "Vermont", nameFr: "Vermont" },
  { code: "VA", name: "Virginia", nameFr: "Virginie" },
  { code: "WA", name: "Washington", nameFr: "Washington" },
  { code: "WV", name: "West Virginia", nameFr: "Virginie-Occidentale" },
  { code: "WI", name: "Wisconsin", nameFr: "Wisconsin" },
  { code: "WY", name: "Wyoming", nameFr: "Wyoming" },
  { code: "AS", name: "American Samoa", nameFr: "Samoa américaines" },
  { code: "GU", name: "Guam", nameFr: "Guam" },
  { code: "MP", name: "Northern Mariana Islands", nameFr: "Îles Mariannes du Nord" },
  { code: "PR", name: "Puerto Rico", nameFr: "Porto Rico" },
  { code: "VI", name: "U.S. Virgin Islands", nameFr: "Îles Vierges des États-Unis" },
  { code: "UM", name: "U.S. Minor Outlying Islands", nameFr: "Îles mineures éloignées des États-Unis" },
];
/** Canadian provinces/territories: address only, NO tax is charged (US-based organisation). */
export const caProvinces: Subdivision[] = [
  { code: "AB", name: "Alberta", nameFr: "Alberta" },
  { code: "BC", name: "British Columbia", nameFr: "Colombie-Britannique" },
  { code: "MB", name: "Manitoba", nameFr: "Manitoba" },
  { code: "NB", name: "New Brunswick", nameFr: "Nouveau-Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador", nameFr: "Terre-Neuve-et-Labrador" },
  { code: "NS", name: "Nova Scotia", nameFr: "Nouvelle-Écosse" },
  { code: "NT", name: "Northwest Territories", nameFr: "Territoires du Nord-Ouest" },
  { code: "NU", name: "Nunavut", nameFr: "Nunavut" },
  { code: "ON", name: "Ontario", nameFr: "Ontario" },
  { code: "PE", name: "Prince Edward Island", nameFr: "Île-du-Prince-Édouard" },
  { code: "QC", name: "Quebec", nameFr: "Québec" },
  { code: "SK", name: "Saskatchewan", nameFr: "Saskatchewan" },
  { code: "YT", name: "Yukon", nameFr: "Yukon" },
];
/** Countries that need a state/province; others have none. The DB column is still called "province". */
export const subdivisionsFor = (country: string): Subdivision[] | null => (country === "United States" ? usStates : country === "Canada" ? caProvinces : null);
/** @deprecated kept for older imports; Canadian list. */
export const provinces = caProvinces;
export const defaultCountry = "United States";
export const defaultProvince = ""; // no state preselected: the member picks one
/** Country list stays international; United States first and default. Extend freely. */
export const countries = ["United States", "Canada", "Mexico", "United Kingdom", "Ireland", "France", "Germany", "Netherlands", "Australia", "New Zealand", "India", "Singapore", "South Africa", "Other"];

/**
 * Sales tax on membership dues. Default: NO sales tax (empty table).
 * Per-state override: { "NY": { rate: 0.08875, label: "NY sales tax 8.875%" } } (rate = decimal), applied to US addresses only.
 * TODO(tax): membership dues are generally not taxable for a US not-for-profit, but this depends on entity type and state;
 * confirm with an accountant and prefer Stripe Tax (automatic_tax) over a hand-kept table before charging tax anywhere.
 */
export const salesTaxByState: Record<string, { rate: number; label: string }> = {};

export const cpeCycleTarget = 20;

/**
 * Product defaults chosen pending founder decisions (change here):
 * - directoryOptInDefault: member directory listing is OFF by default (privacy by design).
 * - Student tier: requires an eligibility attestation + institution at join; membership stays
 *   "pending_verification" after payment until staff approve it in Admin → Members.
 * - eventCurrency: event ticket prices are set and charged in USD.
 * - loginRateLimit: 5 failed attempts per email (or 20 per IP) in 15 min → temporary lockout.
 */
export const directoryOptInDefault = false;
export const eventCurrency: Currency = "USD";
export const loginRateLimit = {
  windowMs: 15 * 60 * 1000, // failures older than this are forgotten
  maxPerEmail: 5, // failures before per-account backoff starts
  baseLockMs: 60 * 1000, // first lock 1 min, doubling each further failure...
  maxLockMs: 15 * 60 * 1000, // ...up to 15 min
  maxPerIp: 20, // per-IP failures before responses are slowed (never locks). Only used with TRUSTED_PROXY=true.
  ipDelayStepMs: 500, ipDelayMaxMs: 5000,
}

export const getTier = (id: string) => tiers.find((t) => t.id === id);
const nf = (locale: string, c: Currency, digits: number) =>
  locale === "fr" ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: c, minimumFractionDigits: digits, maximumFractionDigits: digits }) : null;
/** Money formatting: EN "US$145" (historic "CA$195"); FR "145 $US" / "195 $CA" (fr-FR, always shows which dollar). */
export const fmt = (cents: number, c: Currency, locale = "en") => {
  const d = cents % 100 ? 2 : 0; const f = nf(locale, c, d);
  return f ? f.format(cents / 100) : `${currencyPrefix[c]}${(cents / 100).toFixed(d)}`;
};
export const fmt2 = (cents: number, c: Currency, locale = "en") => {
  const f = nf(locale, c, 2);
  return f ? f.format(cents / 100) : `${currencyPrefix[c]}${(cents / 100).toFixed(2)}`;
};
export const isProvince = (country: string, code?: string | null) => !!subdivisionsFor(country)?.some((p) => p.code === code);
/** Tax on dues: only US addresses whose state is in salesTaxByState (empty by default → always 0). Canada/others: none. */
export function taxFor(country: string, province: string | undefined | null, amount: number) {
  const t = country === "United States" && province ? salesTaxByState[province] : undefined;
  return t ? { rate: t.rate, label: t.label, amount: Math.round(amount * t.rate) } : { rate: 0, label: "", amount: 0 };
}

/** Display labels for event enum values stored in the DB (QA BUG-028). Add new types/formats here. */
export const eventLabels: Record<string, Record<Locale, string>> = {
  Webinar: { en: "Webinar", fr: "Webinaire" }, Chapter: { en: "Chapter", fr: "Section locale" }, Conference: { en: "Conference", fr: "Congrès" },
  Online: { en: "Online", fr: "En ligne" }, "In person": { en: "In person", fr: "En personne" }, Hybrid: { en: "Hybrid", fr: "Hybride" },
};
export const evLabel = (v: string, locale: string) => eventLabels[v]?.[locale as Locale] ?? v;

/**
 * What happens when staff reject a student eligibility check (QA BUG-023). Pending Bhanu's refund-policy decision.
 * Override with env REJECTED_STUDENT_POLICY.
 *  - "notice_manual_refund" (default): member sees the rejection + reason; payment flagged "refund_due" for staff to refund by hand in Stripe. No automatic refund.
 *  - "notice_only": member sees the rejection + reason; no refund flag.
 */
export type RejectedStudentPolicy = "notice_manual_refund" | "notice_only";
export const rejectedStudentPolicy = (): RejectedStudentPolicy =>
  process.env.REJECTED_STUDENT_POLICY === "notice_only" ? "notice_only" : "notice_manual_refund";

/**
 * Account-deletion product decisions (pending Bhanu). Defaults keep current behaviour. Env overrides:
 *  DELETED_USER_PAID_TICKETS = "keep" (default; paid seat stays confirmed, anonymised) | "cancel" (seat freed, record kept)
 *  DELETED_MEMBERSHIP_REFUND = "none" (default; cancelled without refund) | "flag_manual_refund" (paid membership flagged "refund due" in admin)
 */
export const deletionPolicy = () => ({
  paidTickets: process.env.DELETED_USER_PAID_TICKETS === "cancel" ? "cancel" : "keep",
  membershipRefund: process.env.DELETED_MEMBERSHIP_REFUND === "flag_manual_refund" ? "flag_manual_refund" : "none",
});

/** Unpaid (status "pending") membership orders expire after this many hours (BUG-042). Env UNPAID_ORDER_TTL_HOURS, default 24. */
export const unpaidOrderTtlHours = () => { const n = Number(process.env.UNPAID_ORDER_TTL_HOURS); return Number.isFinite(n) && n > 0 ? n : 24; };
