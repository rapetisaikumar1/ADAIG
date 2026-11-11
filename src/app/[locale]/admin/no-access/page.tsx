import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminNav } from "@/components/AppShell";
import { Icon } from "@/components/ui/Icon";
import { requireAdminContext } from "@/lib/rbac";
import { adminHomePath, NO_ACCESS_PATH } from "@/lib/permissions";
export const dynamic = "force-dynamic";

/**
 * /admin/no-access (round 7, SPEC_R7 §3.2/§4.9): where a page or action guard sends an active admin whose role lacks the permission,
 * and the landing page for a role with no Admin Portal tools at all. Any active admin may open it. Calm, in the admin shell, one way
 * on: the admin's home (the first module their role can view) or, with no tools, Profile & privacy.
 */
export default async function AdminNoAccess({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminContext(locale);
  const t = await getTranslations("admin"); const tn = await getTranslations("adminNav");
  const home = adminHomePath(ctx.permissions);
  const none = home === NO_ACCESS_PATH;
  return (
    <div className="app adm"><AdminNav locale={locale} current={NO_ACCESS_PATH} />
      <main id="main" tabIndex={-1} className="app-main">
        <section className="adm-noaccess" aria-labelledby="noaccess-h">
          <span className="icon-tile adm-noaccess-ic"><Icon name="lock" size={22} /></span>
          <h1 id="noaccess-h">{t(none ? "noAccessNoneTitle" : "noAccessTitle")}</h1>
          <p className="adm-noaccess-body">{t(none ? "noAccessNone" : "noAccessBody")}</p>
          {ctx.role && <p className="adm-noaccess-role"><Icon name="key" size={16} />{t("noAccessRole", { role: ctx.role.name })}</p>}
          <div className="adm-noaccess-actions">
            {none
              ? <a className="btn btn-primary" href={`/${locale}/my/profile`}><Icon name="user" size={18} />{tn("profile")}</a>
              : <a className="btn btn-primary" href={`/${locale}${home}`}><Icon name="home" size={18} />{t("adminHome")}</a>}
          </div>
        </section>
      </main>
    </div>
  );
}
