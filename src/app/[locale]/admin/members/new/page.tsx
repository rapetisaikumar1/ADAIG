import { NextIntlClientProvider } from "next-intl";
import { getTranslations, getMessages, setRequestLocale } from "next-intl/server";
import { requireAdminPermission } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { AdminHead } from "../../_components/AdminUI";
import { type Locale } from "@/config/site";
import { allTiers, directoryOptInDefault } from "@/lib/settings";
import { renewalDayValue } from "@/lib/membership";
import { NewAccountForm } from "./NewAccountForm";
export const dynamic = "force-dynamic";

/** Admin → Members → New account: a guest or member added offline (members.create). Admin Portal accounts are created in Users. */
export default async function AdminNewAccount({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdminPermission(locale, "members", "create"); const t = await getTranslations("admin"); const tm = await getTranslations("adminMembers");
  const tiers = (await allTiers()).map((x) => ({ id: x.id, name: x.name[locale] ?? x.name.en })); // admin-editable names (Admin → Settings)
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/members" />
      <main id="main" tabIndex={-1} className="app-main adm-mbr">
        <AdminHead back={{ href: `/${locale}/admin/members`, label: t("membersTitle") }} title={tm("newAccount")} lead={tm("newHint")} />
        {/* The form is a client component: give it only the admin message namespaces it uses. */}
        <NextIntlClientProvider messages={Object.fromEntries(Object.entries(await getMessages()).filter(([k]) => k === "admin" || k === "adminMembers"))}>
          <NewAccountForm locale={locale} tiers={tiers} minDay={renewalDayValue(new Date(Date.now() + 864e5))} directoryDefault={await directoryOptInDefault()} />
        </NextIntlClientProvider>
      </main>
    </div>
  );
}
