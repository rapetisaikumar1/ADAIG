import { getTranslations } from "next-intl/server";
import { AdminNav } from "@/components/AppShell";
import { Icon } from "@/components/ui/Icon";
import { FacetArt } from "@/components/ui/Facet";
import { getAdminContext } from "@/lib/rbac";
import { adminHomePath, NO_ACCESS_PATH } from "@/lib/permissions";

/** The admin portal's 404 body (admin shell + designed empty state). Used by admin/not-found.tsx and, for deeper unknown
 *  /admin/* URLs that never reach the admin segment, by the [locale] not-found — so both paths look the same. Admins only.
 *  One way back: the admin's home (the first module their role can view); a role with no tools goes to Profile & privacy. */
export async function AdminNotFoundView({ locale }: { locale: string }) {
  const t = await getTranslations("errors"); const ta = await getTranslations("admin"); const tn = await getTranslations("adminNav");
  const home = adminHomePath((await getAdminContext())?.permissions);
  const none = home === NO_ACCESS_PATH;
  return (
    <div className="app adm"><AdminNav locale={locale} current="" />
      <main id="main" tabIndex={-1} className="app-main">
        <div className="adm-404">
          <div className="empty-state">
            <FacetArt name="empty" className="empty-art" />
            <h1>{t("notFoundTitle")}</h1>
            <p>{t("notFoundBody")}</p>
            <div className="empty-actions">
              {none
                ? <a className="btn btn-primary btn-sm" href={`/${locale}/my/profile`}><Icon name="user" size={16} />{tn("profile")}</a>
                : <a className="btn btn-primary btn-sm" href={`/${locale}${home}`}><Icon name="home" size={16} />{ta("adminHome")}</a>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
