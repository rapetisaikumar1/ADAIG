import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { saveProfile, deleteAccount } from "./actions";
export const dynamic = "force-dynamic";

export default async function Profile({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; del?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const sp = await searchParams; const t = await getTranslations("profile"); const ta = await getTranslations("auth"); const tj = await getTranslations("join");
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/profile" />
      <main id="main" className="app-main mbr">
        <div className="mbr-narrow">
          <div className="app-head"><h1>{t("title")}</h1></div>
          {sp.saved && <div className="alert alert-success mbr-alerts" role="status"><div>{t("saved")}</div></div>}
          <form action={saveProfile} className="card mbr-form" aria-labelledby="h-details">
            <input type="hidden" name="locale" value={locale} />
            <h2 id="h-details" style={h2}>{t("details")}</h2>
            <div className="grid g2 mbr-fields">
              <div className="field"><label htmlFor="n">{ta("name")}</label><input type="text" id="n" name="name" defaultValue={u.name} autoComplete="name" required /></div>
              <div className="field"><label htmlFor="e">{ta("email")}</label><input type="email" id="e" value={u.email} readOnly disabled aria-describedby="e-hint" /><span id="e-hint" className="hint">{t("emailHint")}</span></div>
              <div className="field"><label htmlFor="o">{tj("org")}</label><input type="text" id="o" name="organisation" defaultValue={u.organisation ?? ""} autoComplete="organization" /></div>
              <div className="field"><label htmlFor="j">{t("jobTitle")}</label><input type="text" id="j" name="jobTitle" defaultValue={u.jobTitle ?? ""} autoComplete="organization-title" /></div>
              <div className="field"><label htmlFor="l">{t("language")}</label><select id="l" name="prefLocale" defaultValue={u.locale}><option value="en" lang="en">English</option><option value="fr" lang="fr">Français</option></select></div>
            </div>
            <fieldset className="mbr-fieldset"><legend><h2 style={h2}>{t("privacy")}</h2></legend>
              <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={u.directoryOptIn} /> {tj("dir")}</label>
              <label className="check"><input type="checkbox" name="marketingOptIn" defaultChecked={u.marketingOptIn} /> {tj("mkt")}</label>
            </fieldset>
            <div className="mbr-foot"><button className="btn btn-accent">{t("save")}</button></div>
          </form>
          <section className="card mbr-form" aria-labelledby="h-data">
            <h2 id="h-data" style={h2}>{t("dataTitle")}</h2>
            <p>{t("dataBody")}</p>
            {/* Plain <a> on purpose: these are file downloads from an API route, not page navigations. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <div className="mbr-actions"><a className="btn btn-secondary btn-sm" href="/api/me/export">{t("export")}</a><a className="btn btn-secondary btn-sm" href="/api/me/export?format=csv">{t("exportCsv")}</a></div>
          </section>
          <form action={deleteAccount} className="card mbr-form mbr-danger" aria-labelledby="del-h">
            <h2 id="del-h" style={h2}>{t("deleteTitle")}</h2>
            {sp.del === "wrong" && <div className="alert alert-danger" role="alert"><div>{t("deleteWrong")}</div></div>}
            {sp.del === "lastAdmin" && <div className="alert alert-danger" role="alert"><div>{t("deleteLastAdmin")}</div></div>}
            <p>{t("deleteBody")}</p>
            <input type="hidden" name="locale" value={locale} />
            <div className="field" style={{ maxWidth: 360, margin: 0 }}><label htmlFor="dp">{t("deletePassword")}</label><input id="dp" name="password" type="password" autoComplete="current-password" required /></div>
            <label className="check"><input type="checkbox" name="confirm" required /> {t("deleteConfirm")}</label>
            <div className="mbr-foot"><button className="btn btn-danger">{t("deleteBtn")}</button></div>
          </form>
        </div>
      </main>
    </div>
  );
}
