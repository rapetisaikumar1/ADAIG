import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
export default getRequestConfig(async ({ requestLocale }) => {
  const r = await requestLocale;
  const locale = hasLocale(routing.locales, r) ? r : routing.defaultLocale;
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
