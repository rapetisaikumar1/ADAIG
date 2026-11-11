import { NextIntlClientProvider } from "next-intl";
import { getTranslations, getMessages, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { canAssignRole, requireAdminPermission } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { AdminHead } from "../../_components/AdminUI";
import { type Locale } from "@/config/site";
import { roleOrder, isSuperRole } from "../_shared";
import { NewUserForm } from "./NewUserForm";
export const dynamic = "force-dynamic";

/** Admin → Users → Create user (SPEC_R7 §5.1): direct creation, no invitation. Only roles the viewer may assign are offered. */
export default async function AdminNewUser({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "users", "create");
  const t = await getTranslations("adminUsers");
  const roles = roleOrder((await db.adminRole.findMany({ select: { id: true, name: true, description: true, isSystem: true, permissions: true } })).filter((r) => canAssignRole(ctx, r)))
    .map((r) => ({ id: r.id, name: r.name, description: r.description, super: isSuperRole(r.id) }));
  const L = (p: string) => `/${locale}${p}`;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/users" />
      <main id="main" tabIndex={-1} className="app-main adm-users acc-new-user">
        <AdminHead back={{ href: L("/admin/users"), label: t("title") }} title={t("newUser")} lead={t("newLead")} />
        {/* Client form: only the message namespaces it uses. */}
        <NextIntlClientProvider messages={Object.fromEntries(Object.entries(await getMessages()).filter(([k]) => k === "adminUsers"))}>
          <NewUserForm locale={locale} roles={roles} cancelHref={L("/admin/users")} />
        </NextIntlClientProvider>
      </main>
    </div>
  );
}
