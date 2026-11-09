import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import { saveProfile, deleteAccount } from "./actions";
export const dynamic = "force-dynamic";

export default async function Profile({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; del?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const sp = await searchParams; const t = await getTranslations("profile"); const ta = await getTranslations("auth"); const tj = await getTranslations("join");
  return (
    <div className="app"><MemberNav locale={locale} current="/my/profile" />
      <main id="main" className="app-main">
        <div className="app-head"><h1>{t("title")}</h1></div>
        {(await searchParams).saved && <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}><div>{t("saved")}</div></div>}
        <form action={saveProfile} className="card" style={{ maxWidth: 640 }}>
          <input type="hidden" name="locale" value={locale} />
          <div className="field"><label htmlFor="n">{ta("name")}</label><input type="text" id="n" name="name" defaultValue={u.name} required /></div>
          <div className="field"><label htmlFor="e">{ta("email")}</label><input type="text" id="e" value={u.email} readOnly disabled /></div>
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="o">{tj("org")}</label><input type="text" id="o" name="organisation" defaultValue={u.organisation ?? ""} /></div>
            <div className="field"><label htmlFor="j">{t("jobTitle")}</label><input type="text" id="j" name="jobTitle" defaultValue={u.jobTitle ?? ""} /></div>
          </div>
          <div className="field"><label htmlFor="l">Language / Langue</label><select id="l" name="prefLocale" defaultValue={u.locale}><option value="en">English</option><option value="fr">Français</option></select></div>
          <fieldset className="field" style={{ border: 0, padding: 0 }}><legend className="label">{t("privacy")}</legend>
            <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={u.directoryOptIn} /> {tj("dir")}</label>
            <label className="check"><input type="checkbox" name="marketingOptIn" defaultChecked={u.marketingOptIn} /> {tj("mkt")}</label>
          </fieldset>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button className="btn btn-accent">{t("save")}</button><a className="btn btn-secondary" href="/api/me/export">{t("export")}</a><a className="btn btn-secondary" href="/api/me/export?format=csv">{t("exportCsv")}</a></div>
        </form>
        <form action={deleteAccount} className="card" style={{ maxWidth: 640, marginTop: 24, borderColor: "var(--red-700)" }} aria-labelledby="del-h">
          <h2 id="del-h" style={{ fontSize: "var(--fs-lg)" }}>{t("deleteTitle")}</h2>
          {sp.del === "wrong" && <div className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}><div>{t("deleteWrong")}</div></div>}
          {sp.del === "lastAdmin" && <div className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}><div>{t("deleteLastAdmin")}</div></div>}
          <p className="small">{t("deleteBody")}</p>
          <input type="hidden" name="locale" value={locale} />
          <label className="check"><input type="checkbox" name="confirm" required /> {t("deleteConfirm")}</label>
          <div className="field"><label htmlFor="dp">{t("deletePassword")}</label><input id="dp" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="btn btn-danger">{t("deleteBtn")}</button>
        </form>
      </main>
    </div>
  );
}
