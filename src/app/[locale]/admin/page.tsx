import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireAdminContext } from "@/lib/rbac";
import { adminHomePath } from "@/lib/permissions";

/** Bare /<locale>/admin → the admin's home: the first module their role can view (D8 order), else /admin/no-access (SPEC_R7 §4.3). */
export default async function AdminIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminContext(locale);
  redirect(`/${locale}${adminHomePath(ctx.permissions)}`);
}
