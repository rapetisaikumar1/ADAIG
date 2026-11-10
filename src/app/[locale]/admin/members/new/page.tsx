import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { type Locale } from "@/config/site";
import { allTiers, directoryOptInDefault } from "@/lib/settings";
import { renewalDayValue } from "@/lib/membership";
import { NewAccountForm } from "./NewAccountForm";
export const dynamic = "force-dynamic";

/** Admin → Members → New account (staff, or a member added offline). */
export default async function AdminNewAccount({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers");
  const tiers = (await allTiers()).map((x) => ({ id: x.id, name: x.name[locale] ?? x.name.en })); // admin-editable names (Admin → Settings)
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" className="app-main adm-mbr">
        <a className="small adm-mbr-back" href={`/${locale}/admin/members`}>← {t("membersTitle")}</a>
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{tm("newAccount")}</h1></div></div>
        <NewAccountForm locale={locale} tiers={tiers} minDay={renewalDayValue(new Date(Date.now() + 864e5))} directoryDefault={await directoryOptInDefault()} />
      </main>
    </div>
  );
}
