import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, activeMembership } from "@/lib/session";
import { limits } from "@/lib/validation";
import { MemberNav } from "@/components/AppShell";
import { saveProfile, changePassword, deleteAccount } from "./actions";
import { memberMetadata } from "../_shared/meta";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("profile");

const PW_ERRORS = ["wrong", "mismatch", "same", "locked", "short", "long", "blank", "common"] as const;
const LONG_FIELDS = ["name", "organisation", "jobTitle"] as const;

export default async function Profile({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; del?: string; pw?: string; long?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const sp = await searchParams; const t = await getTranslations("profile"); const ta = await getTranslations("auth"); const tj = await getTranslations("join");
  const isActive = !!(await activeMembership(u.id));
  const pwErr = PW_ERRORS.find((e) => e === sp.pw);
  const long = String(sp.long ?? "").split(",").filter((f): f is (typeof LONG_FIELDS)[number] => (LONG_FIELDS as readonly string[]).includes(f));
  const fieldLabel = { name: ta("name"), organisation: tj("org"), jobTitle: t("jobTitle") };
  const fieldMax = { name: limits.name, organisation: limits.organisation, jobTitle: limits.jobTitle };
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/profile" />
      <main id="main" className="app-main mbr">
        <div className="mbr-narrow">
          <div className="app-head"><h1>{t("title")}</h1></div>
          {sp.saved && <div className="alert alert-success mbr-alerts" role="status"><div>{t("saved")}</div></div>}
          {long.length > 0 && <div className="alert alert-warning mbr-alerts" role="alert"><div><b>{t("tooLongTitle")}</b>{t("tooLongBody")}
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{long.map((f) => <li key={f}>{t("tooLongField", { field: fieldLabel[f], max: fieldMax[f] })}</li>)}</ul></div></div>}
          <form action={saveProfile} className="card mbr-form" aria-labelledby="h-details">
            <input type="hidden" name="locale" value={locale} />
            <h2 id="h-details" style={h2}>{t("details")}</h2>
            <div className="grid g2 mbr-fields">
              <div className="field"><label htmlFor="n">{ta("name")}</label><input type="text" id="n" name="name" defaultValue={u.name} autoComplete="name" required maxLength={limits.name} aria-invalid={long.includes("name") || undefined} /></div>
              <div className="field"><label htmlFor="e">{ta("email")}</label><input type="email" id="e" value={u.email} readOnly disabled aria-describedby="e-hint" /><span id="e-hint" className="hint">{t("emailHint")}</span></div>
              <div className="field"><label htmlFor="o">{tj("org")}</label><input type="text" id="o" name="organisation" defaultValue={u.organisation ?? ""} autoComplete="organization" maxLength={limits.organisation} aria-invalid={long.includes("organisation") || undefined} /></div>
              <div className="field"><label htmlFor="j">{t("jobTitle")}</label><input type="text" id="j" name="jobTitle" defaultValue={u.jobTitle ?? ""} autoComplete="organization-title" maxLength={limits.jobTitle} aria-invalid={long.includes("jobTitle") || undefined} /></div>
              <div className="field"><label htmlFor="l">{t("language")}</label><select id="l" name="prefLocale" defaultValue={u.locale} aria-describedby="l-hint"><option value="en" lang="en">English</option><option value="fr" lang="fr">Français</option></select><span id="l-hint" className="hint">{t("languageHint")}</span></div>
            </div>
            <fieldset className="mbr-fieldset"><legend><h2 style={h2}>{t("privacy")}</h2></legend>
              <div>
                <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={u.directoryOptIn} aria-describedby={isActive ? undefined : "dir-hint"} /> {tj("dir")}</label>
                {!isActive && <p id="dir-hint" className="hint" style={{ margin: "4px 0 0" }}>{t("dirHintNonMember")}</p>}
              </div>
              <label className="check"><input type="checkbox" name="marketingOptIn" defaultChecked={u.marketingOptIn} /> {tj("mkt")}</label>
            </fieldset>
            <div className="mbr-foot"><button className="btn btn-accent">{t("save")}</button></div>
          </form>
          <form action={changePassword} className="card mbr-form" aria-labelledby="h-pw">
            <input type="hidden" name="locale" value={locale} />
            {/* Lets password managers attach the new password to the right account. */}
            <input type="text" name="username" value={u.email} autoComplete="username" readOnly hidden />
            <h2 id="h-pw" style={h2}>{t("pwTitle")}</h2>
            <p>{t("pwIntro")}</p>
            {pwErr && <div className="alert alert-danger" role="alert"><div>{t(`pwErr_${pwErr}`)}</div></div>}
            {/* Current password sits alone in the first cell of the same two-column grid, so every input has the same width. */}
            <div className="grid g2 mbr-fields">
              <div className="field"><label htmlFor="pc">{t("pwCurrent")}</label><input id="pc" name="currentPassword" type="password" autoComplete="current-password" required aria-invalid={pwErr === "wrong" || undefined} /></div>
              <div className="field" style={{ gridColumnStart: 1 }}><label htmlFor="pn">{t("pwNew")}</label><input id="pn" name="newPassword" type="password" autoComplete="new-password" required minLength={limits.passwordMin} aria-describedby="pn-hint" aria-invalid={(pwErr && !["wrong", "locked", "mismatch"].includes(pwErr)) || undefined} /><span id="pn-hint" className="hint">{t("pwHint")}</span></div>
              <div className="field"><label htmlFor="pr">{t("pwConfirm")}</label><input id="pr" name="confirmPassword" type="password" autoComplete="new-password" required minLength={limits.passwordMin} aria-invalid={pwErr === "mismatch" || undefined} /></div>
            </div>
            <div className="mbr-foot"><button className="btn btn-accent">{t("pwSave")}</button></div>
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
            <div className="grid g2 mbr-fields"><div className="field"><label htmlFor="dp">{t("deletePassword")}</label><input id="dp" name="password" type="password" autoComplete="current-password" required /></div></div>
            <label className="check"><input type="checkbox" name="confirm" required /> {t("deleteConfirm")}</label>
            <div className="mbr-foot"><button className="btn btn-danger">{t("deleteBtn")}</button></div>
          </form>
        </div>
      </main>
    </div>
  );
}
