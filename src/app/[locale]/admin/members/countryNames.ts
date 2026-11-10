/**
 * French display names for the country list (the stored value stays the English name). Same names as the join form
 * (src/app/[locale]/join/JoinForm.tsx); a country missing here is shown with its English name.
 */
export const countryFr: Record<string, string> = {
  "United States": "États-Unis", Canada: "Canada", Mexico: "Mexique", "United Kingdom": "Royaume-Uni", Ireland: "Irlande", France: "France",
  Germany: "Allemagne", Netherlands: "Pays-Bas", Australia: "Australie", "New Zealand": "Nouvelle-Zélande", India: "Inde", Singapore: "Singapour",
  "South Africa": "Afrique du Sud", Other: "Autre",
};
export const countryLabel = (c: string, locale: string) => (locale === "fr" ? countryFr[c] ?? c : c);
