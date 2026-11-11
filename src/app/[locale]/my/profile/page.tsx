import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, activeMembership } from "@/lib/session";
import { limits } from "@/lib/validation";
import { AdminNav, MemberNav } from "@/components/AppShell";
import { saveProfile, changePassword, deleteAccount } from "./actions";
import { memberMetadata } from "../_shared/meta";
import { PageHead, Notice } from "../_shared/ui";
import { membershipState, membershipDates, statusTone } from "../_shared/membership";
import { tierLookup } from "@/lib/settings";
import { Status } from "@/components/ui/Facet";
import { LocationFields } from "./LocationFields";
import type { Locale } from "@/config/site";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("profile");

const PW_ERRORS = ["wrong", "mismatch", "same", "locked", "short", "long", "blank", "common"] as const;
const LONG_FIELDS = ["name", "organisation", "jobTitle"] as const;
const BAD_FIELDS = ["name", "country", "province"] as const;
/** Form control id of each field that saveProfile can report back (inline error = `<id>-err`). */
const FIELD_ID = { name: "n", organisation: "o", jobTitle: "j", country: "pf-country", province: "pf-prov" } as const;
/** deleteAccount's results (`?del=`) and their messages: wrong password or box not ticked, too many wrong passwords (login
 *  throttle), the last active Super Admin, an Admin Portal account (refused on the server: those are closed by deactivation). */
const DEL_ERRORS = { wrong: "deleteWrong", locked: "deleteLocked", lastAdmin: "deleteLastAdmin", admin: "deleteAdminBlocked" } as const;
type ErrField = keyof typeof FIELD_ID;

export default async function Profile({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; del?: string; pw?: string; long?: string; bad?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const sp = await searchParams; const t = await getTranslations("profile"); const ta = await getTranslations("auth"); const tj = await getTranslations("join");
  const isAdmin = u.role === "admin";
  // Read-only membership summary for association members and guests (admin-portal users get none: D1/D10). Same reading and
  // labels as My membership (../_shared/membership.ts), so the two pages always agree.
  const ms = isAdmin ? null : await membershipState(u.id);
  const tb = await getTranslations("member.billingPage");
  const getTier = ms?.m ? await tierLookup() : null;
  const isActive = ms ? ms.status === "active" : !!(await activeMembership(u.id));
  const pwErr = PW_ERRORS.find((e) => e === sp.pw);
  const delErr = Object.hasOwn(DEL_ERRORS, sp.del ?? "") ? DEL_ERRORS[sp.del as keyof typeof DEL_ERRORS] : null;
  const pwNewErr = !!pwErr && !["wrong", "locked", "mismatch"].includes(pwErr); // errors about the new password itself
  const list = <T extends string>(v: string | undefined, allowed: readonly T[]) => String(v ?? "").split(",").filter((f): f is T => (allowed as readonly string[]).includes(f));
  const long = list(sp.long, LONG_FIELDS), bad = list(sp.bad, BAD_FIELDS);
  const isUS = u.country === "United States";
  const fieldLabel: Record<ErrField, string> = { name: ta("name"), organisation: tj("org"), jobTitle: t("jobTitle"), country: tj("country"), province: tj(isUS ? "state" : "province") };
  const fieldMax = { name: limits.name, organisation: limits.organisation, jobTitle: limits.jobTitle };
  // Fields saveProfile left unchanged: one message per field, shown under it (aria-describedby) and listed in the summary.
  const errs: Partial<Record<ErrField, { id: string; text: string }>> = {};
  for (const f of long) errs[f] = { id: `${FIELD_ID[f]}-err`, text: t("errTooLong", { max: fieldMax[f] }) };
  for (const f of bad) errs[f] = { id: `${FIELD_ID[f]}-err`, text: t(f === "name" ? "errNameBlank" : f === "country" ? "errCountry" : "errProvince") };
  const errKeys = (Object.keys(FIELD_ID) as ErrField[]).filter((f) => errs[f]); // in form order
  const fieldErr = (f: ErrField) => errs[f] && <span className="error-msg" id={errs[f].id}>{errs[f].text}</span>;
  const fcls = (f: ErrField) => `field${errs[f] ? " error" : ""}`;
  const L = (p: string) => `/${locale}${p}`;
  const msFacts = ms?.m ? membershipDates(ms.m, (k) => tb(k), locale) : [];
  return (
    <div className={isAdmin ? "app adm" : "app"}>{isAdmin ? <AdminNav locale={locale} current="/my/profile" /> : <MemberNav locale={locale} current="/my/profile" />}
      <main id="main" tabIndex={-1} className="app-main mbr mbr-profile">
        <PageHead title={t("title")} lead={t("lead")} />
        {/* Results of the member's own submit take focus (D7 / FA-5), so they are announced and scrolled into view. */}
        {sp.saved && <FocusOnLoad className="mbr-flash"><Notice tone="success">{t("saved")}</Notice></FocusOnLoad>}
        {errKeys.length > 0 && <FocusOnLoad className="mbr-flash"><Notice tone="warning" role="alert" title={t("tooLongTitle")}>{t("notSavedBody")}
          <ul className="mbr-alert-list">{errKeys.map((f) => <li key={f}><a href={`#${FIELD_ID[f]}`}>{fieldLabel[f]}</a></li>)}</ul></Notice></FocusOnLoad>}

        {ms && (
          // Membership at a glance (read-only; managed by the ADAIG team). Details, notices and contact on My membership.
          <div className="mbr-sheet">
            <section className="settings-section mbr-ms" aria-labelledby="h-ms">
              <header><h2 id="h-ms">{t("membershipTitle")}</h2><p>{t("membershipDesc")}</p></header>
              <div className="mbr-section-body">
                {ms.m ? (
                  <dl className="mbr-ms-facts">
                    <div><dt>{tb("tier")}</dt><dd className="mbr-ms-tier">{getTier?.(ms.m.tierId)?.name[locale as Locale] ?? ms.m.tierId}</dd></div>
                    <div><dt>{tb("status")}</dt><dd><Status tone={statusTone(ms.status)}>{tb(`st_${ms.status}`)}</Status></dd></div>
                    {msFacts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                  </dl>
                ) : (
                  <div className="mbr-ms-none"><Status tone="neutral">{tb("st_none")}</Status><p>{tb("noneBody")}</p></div>
                )}
                <p className="mbr-ms-foot">
                  {ms.status === "none" && <a className="btn btn-secondary btn-sm" href={L("/join")}>{tb("apply")}</a>}
                  <a className="link-arrow" href={L("/my/billing")}>{t("membershipLink")}</a>
                </p>
              </div>
            </section>
          </div>
        )}

        {/* Settings sheet: section title + description on the left, fields on the right (DESIGN_R5 §10.4); stacks ≤900px. */}
        <div className="mbr-sheet">
          <form action={saveProfile} className="mbr-settings-form">
            <input type="hidden" name="locale" value={locale} />
            <section className="settings-section" aria-labelledby="h-details">
              <header><h2 id="h-details">{t("details")}</h2><p>{t("detailsDesc")}</p></header>
              <div className="form-grid mbr-fields">
                <div className={fcls("name")}><label htmlFor="n">{ta("name")}</label><input type="text" id="n" name="name" defaultValue={u.name} autoComplete="name" required maxLength={limits.name} aria-invalid={!!errs.name || undefined} aria-describedby={errs.name?.id} />{fieldErr("name")}</div>
                <div className="field"><label htmlFor="e">{ta("email")}</label><input type="email" id="e" value={u.email} readOnly aria-describedby="e-hint" /><span id="e-hint" className="hint">{t.rich("emailHint", { link: (c) => <a href={L("/contact")}>{c}</a> })}</span></div>
                <div className={fcls("organisation")}><label htmlFor="o">{tj("org")}</label><input type="text" id="o" name="organisation" defaultValue={u.organisation ?? ""} autoComplete="organization" maxLength={limits.organisation} aria-invalid={!!errs.organisation || undefined} aria-describedby={errs.organisation?.id} />{fieldErr("organisation")}</div>
                <div className={fcls("jobTitle")}><label htmlFor="j">{t("jobTitle")}</label><input type="text" id="j" name="jobTitle" defaultValue={u.jobTitle ?? ""} autoComplete="organization-title" maxLength={limits.jobTitle} aria-invalid={!!errs.jobTitle || undefined} aria-describedby={errs.jobTitle?.id} />{fieldErr("jobTitle")}</div>
                <LocationFields locale={locale} country={u.country} province={u.province ?? ""} countryErr={errs.country ?? null} provinceErr={errs.province ?? null}
                  labels={{ country: tj("country"), state: tj("state"), province: tj("province"), blank: t("provinceBlank") }} />
              </div>
            </section>
            <section className="settings-section" aria-labelledby="h-privacy">
              <header><h2 id="h-privacy">{t("privacy")}</h2><p>{t("privacyDesc")}</p></header>
              <div className="mbr-pref">
                {/* No "Preferred language" choice (client, round 6b: French is not offered). saveProfile still stores prefLocale,
                    so the member's current value is re-submitted unchanged (a missing field would reset it to the page locale). */}
                <input type="hidden" name="prefLocale" value={u.locale} />
                <fieldset className="mbr-checks" style={{ borderTop: 0, paddingTop: 0 }}>{/* first item now: no divider above it (it separated the removed language field) */}<legend className="sr-only">{t("privacy")}</legend>
                  <div className="mbr-check-row">
                    <label className="check"><input type="checkbox" name="directoryOptIn" defaultChecked={u.directoryOptIn} aria-describedby="dir-hint" /> <span>{t("dirLabel")}</span></label>
                    <p id="dir-hint" className="hint">{t("dirHint")}{!isActive && <> {t("dirHintNonMember")}</>}</p>
                  </div>
                  <div className="mbr-check-row">
                    <label className="check"><input type="checkbox" name="marketingOptIn" defaultChecked={u.marketingOptIn} aria-describedby="mkt-hint" /> <span>{t("mktLabel")}</span></label>
                    <p id="mkt-hint" className="hint">{t("mktHint")}</p>
                  </div>
                </fieldset>
                {/* Every save row on this page sits at the end of its section's fields column (one variant, QA-PORTALS-2-6). */}
                <div className="save-row"><button className="btn btn-accent">{t("save")}</button></div>
              </div>
            </section>
          </form>
        </div>

        <div className="mbr-sheet">
          <form action={changePassword} className="settings-section" aria-labelledby="h-pw">
            <input type="hidden" name="locale" value={locale} />
            {/* Lets password managers attach the new password to the right account. */}
            <input type="text" name="username" value={u.email} autoComplete="username" readOnly hidden />
            <header><h2 id="h-pw">{t("pwTitle")}</h2><p>{t("pwIntro")}</p></header>
            <div className="mbr-section-body">
              {pwErr && <FocusOnLoad><Notice tone="danger" role="alert" id="pw-err">{t(`pwErr_${pwErr}`)}</Notice></FocusOnLoad>}
              {/* Current password sits alone in the first cell of the same two-column grid, so every input has the same width. */}
              <div className="form-grid mbr-fields">
                <div className="field"><label htmlFor="pc">{t("pwCurrent")}</label><input id="pc" name="currentPassword" type="password" autoComplete="current-password" required aria-invalid={pwErr === "wrong" || undefined} aria-describedby={pwErr === "wrong" || pwErr === "locked" ? "pw-err" : undefined} /></div>
                <div className="field" style={{ gridColumnStart: 1 }}><label htmlFor="pn">{t("pwNew")}</label><input id="pn" name="newPassword" type="password" autoComplete="new-password" required minLength={limits.passwordMin} aria-describedby={pwNewErr ? "pn-hint pw-err" : "pn-hint"} aria-invalid={pwNewErr || undefined} /><span id="pn-hint" className="hint">{t("pwHint")}</span></div>
                <div className="field"><label htmlFor="pr">{t("pwConfirm")}</label><input id="pr" name="confirmPassword" type="password" autoComplete="new-password" required minLength={limits.passwordMin} aria-invalid={pwErr === "mismatch" || undefined} aria-describedby={pwErr === "mismatch" ? "pw-err" : undefined} /></div>
              </div>
              <div className="save-row"><button className="btn btn-accent">{t("pwSave")}</button></div>
            </div>
          </form>
          <section className="settings-section" aria-labelledby="h-data">
            <header><h2 id="h-data">{t("dataTitle")}</h2><p>{t("dataBody")}</p></header>
            {/* Plain <a> on purpose: these are file downloads from an API route, not page navigations. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <div className="mbr-downloads"><a className="btn btn-secondary" href="/api/me/export"><Icon name="download" size={18} />{t("export")}</a><a className="btn btn-secondary" href="/api/me/export?format=csv"><Icon name="download" size={18} />{t("exportCsv")}</a></div>
          </section>
        </div>

        {isAdmin ? (
          // Admin Portal accounts can't delete themselves here (FIXLIST7 S1; refused in deleteAccount too): a Super Admin
          // deactivates them in Users. A calm note in place of the danger zone; `mbr-admin-close` is an E2E hook.
          <div className="mbr-sheet mbr-admin-close">
            <section className="settings-section" aria-labelledby="h-close">
              <header><h2 id="h-close">{t("adminCloseTitle")}</h2></header>
              <div className="mbr-section-body">
                {delErr && <FocusOnLoad><Notice tone="danger" role="alert" id="del-err">{t(delErr)}</Notice></FocusOnLoad>}
                <Notice tone="info" role="note">{t("adminCloseNote")}</Notice>
              </div>
            </section>
          </div>
        ) : (
        /* Danger zone (DESIGN_R5 §10.5) on the same settings grid as the cards above: label + title + description left, text,
            fields and save row right; outline destructive button that turns solid once the box is ticked. `mbr-danger` is an E2E hook. */
        <form action={deleteAccount} className="panel danger-zone mbr-danger" aria-labelledby="del-h">
          <input type="hidden" name="locale" value={locale} />
          <section className="settings-section">
            <header>
              <p className="danger-zone-label"><Icon name="alert" size={16} />{t("dangerLabel")}</p>
              <h2 id="del-h">{t("deleteTitle")}</h2>
              <p>{t("deleteDesc")}</p>
            </header>
            <div className="mbr-section-body">
              {/* The error takes focus, which also scrolls the danger zone into view (the action redirects without an anchor). */}
              {delErr && <FocusOnLoad><Notice tone="danger" role="alert" id="del-err">{t(delErr)}</Notice></FocusOnLoad>}
              <p className="mbr-dz-body">{t("deleteBody")}</p>
              <div className="form-grid mbr-fields"><div className="field"><label htmlFor="dp">{t("deletePassword")}</label><input id="dp" name="password" type="password" autoComplete="current-password" required aria-invalid={delErr === "deleteWrong" || undefined} aria-describedby={delErr ? "del-err" : undefined} /></div></div>
              <div className="save-row">
                <label className="check"><input type="checkbox" name="confirm" required /> <span>{t("deleteConfirm")}</span></label>
                <button className="btn btn-danger-outline"><Icon name="trash" size={18} />{t("deleteBtn")}</button>
              </div>
            </div>
          </section>
        </form>
        )}
      </main>
    </div>
  );
}
