import { NextIntlClientProvider } from "next-intl";
import { getTranslations, getMessages, setRequestLocale } from "next-intl/server";
import { requireAdminPermission } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { AdminHead } from "../../_components/AdminUI";
import { type Locale } from "@/config/site";
import { createRole } from "../actions";
import { RoleForm } from "../RoleForm";
export const dynamic = "force-dynamic";

/** Admin → Roles → Create role (roles.create): name, description and the permission matrix, limited to the actor's own permissions. */
export default async function AdminNewRole({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "roles", "create");
  const t = await getTranslations("adminRoles");
  const L = (p: string) => `/${locale}${p}`;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/roles" />
      <main id="main" tabIndex={-1} className="app-main rl-page">
        <AdminHead back={{ href: L("/admin/roles"), label: t("title") }} title={t("newRole")} lead={t("lead")} />
        <NextIntlClientProvider messages={Object.fromEntries(Object.entries(await getMessages()).filter(([k]) => k === "adminRoles"))}>
          <RoleForm locale={locale} action={createRole} initial={[]} actor={ctx.permissions} cancelHref={L("/admin/roles")} submitLabel={t("create")} />
        </NextIntlClientProvider>
      </main>
    </div>
  );
}
