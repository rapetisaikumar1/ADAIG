import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { AdminHead, AdminReadOnly, AdminDl } from "../_components/AdminUI";
import { type Locale } from "@/config/site";
import { eventTimeZone, dateLocale } from "@/lib/time";
import {
  SITE_KEY, OPS_KEY, tierKey, resolveTiers, opsSchema, siteSchema, opsDefaults,
  REJECTED_POLICIES, PAID_TICKET_POLICIES, MEMBERSHIP_REFUND_POLICIES,
} from "@/lib/settings";
import { saveTier, resetTier, resetAllTiers, saveSite, saveOps, resetSite, resetOps } from "./actions";
import { FrBenefits } from "./FrBenefits";
export const dynamic = "force-dynamic";

const MSGS: Record<string, "alert-success" | "alert-danger"> = {
  saved: "alert-success", reset: "alert-success", invalid: "alert-danger", benefitsMismatch: "alert-danger", lastVisible: "alert-danger",
  conflict: "alert-danger", invalidEmail: "alert-danger",
};

/** Admin → Settings: membership tiers, public contact details, operational policies (Setting table; missing row = default). */
export default async function AdminSettings({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ msg?: string; s?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "system", "view");
  // Without system.edit the page is read-only (§5.5): one notice at the top and the values as compact read-only lists
  // (VIS m7: no disabled inputs, no edit hints, "Not set" for empty values), no forms.
  const canEdit = can(ctx, "system", "edit");
  const t = await getTranslations("adminSettings"); const ta = await getTranslations("admin"); const tm = await getTranslations("adminMembers");
  const { msg, s } = await searchParams;
  // Read fresh (uncached) so the concurrency tokens below match the database.
  const rows = await db.setting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const tiers = resolveTiers(new Map(rows.map((r) => [r.key, r.value as unknown])));
  const site = siteSchema.safeParse(byKey.get(SITE_KEY)?.value ?? {}); const siteV = site.success ? site.data : { contactEmail: "", postalAddress: "" };
  const ops = opsSchema.safeParse(byKey.get(OPS_KEY)?.value ?? {}); const opsV = ops.success ? ops.data : {};
  const def = opsDefaults();
  const editors = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.updatedBy).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const stamp = (d: Date) => `${d.toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${ta("et")}`;
  const ver = (key: string) => byKey.get(key)?.updatedAt.toISOString() ?? "none";
  const meta = (key: string) => {
    const r = byKey.get(key);
    return r ? <span className="small muted">{t("changedBy", { date: stamp(r.updatedAt), name: (r.updatedBy && editors.get(r.updatedBy)) || "—" })}</span> : null;
  };
  const notice = (anchor: string) => msg && MSGS[msg] && s === anchor
    ? <FocusOnLoad><div className={`alert ${MSGS[msg]}`} role={MSGS[msg] === "alert-danger" ? "alert" : "status"}><div>{t(`msg_${msg}`)}</div></div></FocusOnLoad> : null;
  const hidden = (extra?: Record<string, string>) => (
    <><input type="hidden" name="locale" value={locale} />{Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>
  );
  // "Default: keep the seat (anonymized)": the option label is lower-cased after the colon (no nested parentheses).
  const defaultLabel = (v: string) => t("useDefault", { value: v.charAt(0).toLocaleLowerCase(locale) + v.slice(1) });
  /** Textarea height from its text: rough count of wrapped lines (≈44 characters per line) of the longest text. */
  const pairRows = (texts: string[], min: number, max: number) => {
    const lines = (s: string) => s.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 44)), 0);
    return Math.min(max, Math.max(min, ...texts.map((x) => lines(x) + 1)));
  };
  /** "Reset" with a confirm step. The confirm button submits a separate reset form (forms can't be nested), placed after the card. */
  const resetConfirm = (formId: string, label: string, text: string) => (
    <details className="confirm adm-confirm adm-set-reset"><summary className="btn btn-ghost btn-sm">{label}…</summary>
      <div className="confirm-box"><p>{text}</p><div className="confirm-actions"><button type="submit" form={formId} className="btn btn-danger btn-sm">{t("resetYes")}</button></div></div>
    </details>
  );
  const yn = (b: boolean) => tm(b ? "ro_yes" : "ro_no");
  const dirLabel = (on: boolean) => (on ? t("dirOn") : t("dirOff"));
  const legacyOpen = opsV.unpaidOrderTtlHours !== undefined || opsV.rejectedStudentPolicy !== undefined || opsV.deletedMembershipRefund !== undefined;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/settings" />
      <main id="main" tabIndex={-1} className="app-main adm-settings">
        <AdminHead title={t("title")} lead={t("lead")} />
        {!canEdit && <AdminReadOnly text={ta("readOnly")} />}
        <nav className="chips adm-set-jump" aria-label={t("jump")}><a className="chip" href="#tiers">{t("tiersTitle")}</a><a className="chip" href="#site">{t("siteTitle")}</a><a className="chip" href="#ops">{t("opsTitle")}</a></nav>

        {/* ── Membership tiers ───────────────────────────────────────────── */}
        <section className="adm-set-group" id="tiers" aria-labelledby="tiers-h">
          <header>
            <div><h2 id="tiers-h">{t("tiersTitle")}</h2><p>{t("tiersLead")}</p></div>
            {canEdit && tiers.some((x) => x.overridden) && (
              <details className="confirm adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("resetAll")}…</summary>
                <form action={resetAllTiers} className="confirm-box">{hidden()}<p>{t("resetAllConfirm")}</p><div className="confirm-actions"><button className="btn btn-danger btn-sm">{t("confirmYes")}</button></div></form>
              </details>
            )}
          </header>
          {notice("tiers")}
          {!canEdit ? <div className="adm-set-list is-ro">
            {tiers.map((tier) => {
              const key = tierKey(tier.id); const p = `t-${tier.id}`;
              return (
                <section key={tier.id} className="panel adm-set-card is-ro" id={key.replace(/\./g, "-")} aria-labelledby={`${p}-h`}>
                  <div className="panel-head">
                    <h3 id={`${p}-h`}>{tier.name[locale]} <span className="adm-set-id">{t("tierId", { id: tier.id })}</span></h3>
                    <div className="tags">
                      {tier.overridden ? <span className="status status-dev">{t("customized")}</span> : <span className="status status-neutral">{t("notCustomized")}</span>}
                      {!tier.visible && <span className="status status-danger">{t("hiddenBadge")}</span>}
                      {tier.featured && <span className="status status-members">{t("featuredBadge")}</span>}
                    </div>
                  </div>
                  {meta(key)}
                  <AdminDl notSet={t("notSet")} items={[
                    { key: "name", label: t("nameEn"), value: tier.name.en },
                    { key: "order", label: t("order"), value: tier.order },
                    { key: "desc", label: t("descEn"), value: tier.description.en, wide: true },
                    { key: "benefits", label: t("benefitsEn"), value: tier.benefits.length ? <ul>{tier.benefits.map((b, i) => <li key={i}>{b.en}</li>)}</ul> : null, wide: true },
                    { key: "visible", label: t("visible"), value: yn(tier.visible) },
                    { key: "featured", label: t("featured"), value: yn(!!tier.featured) },
                    { key: "verify", label: t("requiresVerification"), value: yn(!!tier.requiresVerification), wide: true },
                  ]} />
                </section>
              );
            })}
          </div> : <div className="adm-set-list">
            {tiers.map((tier) => {
              const key = tierKey(tier.id); const anchor = key.replace(/\./g, "-"); const p = `t-${tier.id}`;
              const benEn = tier.benefits.map((b) => b.en).join("\n");
              const descRows = pairRows([tier.description.en], 3, 8), benRows = pairRows([benEn], 5, 16);
              return (
                [<form key={tier.id} action={saveTier} className="panel adm-set-card" id={anchor} aria-labelledby={`${p}-h`}>
                  {hidden({ id: tier.id, v: ver(key) })}
                  {/* French name/description/benefits are not offered (client, round 6b) but kept: the stored values are re-submitted
                      unchanged, so saving never clears them and the action's EN+FR checks still pass (benefit lines: see FrBenefits). */}
                  <input type="hidden" name="nameFr" value={tier.name.fr} /><input type="hidden" name="descFr" value={tier.description.fr} />
                  <FrBenefits en={tier.benefits.map((b) => b.en)} fr={tier.benefits.map((b) => b.fr)} />
                  <div className="panel-head">
                    <h3 id={`${p}-h`}>{tier.name[locale]} <span className="adm-set-id">{t("tierId", { id: tier.id })}</span></h3>
                    <div className="tags">
                      {tier.overridden ? <span className="status status-dev">{t("customized")}</span> : <span className="status status-neutral">{t("notCustomized")}</span>}
                      {!tier.visible && <span className="status status-danger">{t("hiddenBadge")}</span>}
                      {tier.featured && <span className="status status-members">{t("featuredBadge")}</span>}
                    </div>
                  </div>
                  {meta(key)}
                  {notice(anchor)}
                                    <div className="adm-form-grid">
                    <div className="field"><label htmlFor={`${p}-ne`}>{t("nameEn")}</label><input id={`${p}-ne`} name="nameEn" type="text" required maxLength={60} defaultValue={tier.name.en} /></div>
                    <div className="field span-all"><label htmlFor={`${p}-de`}>{t("descEn")}</label><textarea id={`${p}-de`} name="descEn" required rows={descRows} maxLength={300} defaultValue={tier.description.en} /></div>
                    <div className="field span-all"><label htmlFor={`${p}-be`}>{t("benefitsEn")}</label><textarea id={`${p}-be`} name="benefitsEn" required rows={benRows} defaultValue={benEn} aria-describedby={`${p}-bh`} /></div>
                  </div>
                  <p className="hint adm-set-hint span-all" id={`${p}-bh`}>{t("benefitsHint")}</p>
                  <div className="adm-form-grid adm-set-flags">
                    <div className="field"><label htmlFor={`${p}-o`}>{t("order")}</label><input id={`${p}-o`} name="order" type="number" min={1} max={99} step={1} required defaultValue={tier.order} aria-describedby={`${p}-oh`} /><span className="hint" id={`${p}-oh`}>{t("orderHint")}</span></div>
                    <div className="adm-set-checks">
                      <label className="check"><input type="checkbox" name="visible" defaultChecked={tier.visible} aria-describedby={`${p}-vh`} /> <span>{t("visible")}</span></label>
                      <span className="hint" id={`${p}-vh`}>{t("visibleHint")}</span>
                      <label className="check"><input type="checkbox" name="featured" defaultChecked={!!tier.featured} /> <span>{t("featured")}</span></label>
                      <label className="check"><input type="checkbox" name="requiresVerification" defaultChecked={!!tier.requiresVerification} /> <span>{t("requiresVerification")}</span></label>
                    </div>
                  </div>
                                    {canEdit && <div className="save-row">
                    {tier.overridden && resetConfirm(`${anchor}-reset`, t("resetTier"), t("resetTierConfirm", { name: tier.name[locale] }))}
                    <button className="btn btn-accent">{t("saveTier")}</button>
                  </div>}
                </form>,
                canEdit && tier.overridden && <form key={`${tier.id}-reset`} id={`${anchor}-reset`} action={resetTier} hidden>{hidden({ id: tier.id })}</form>,
              ]);
            })}
          </div>}
        </section>

        {/* ── Public contact details ─────────────────────────────────────── */}
        <section className="adm-set-group" aria-labelledby="site-h">
          {!canEdit ? <div className="panel adm-set-card is-ro" id="site">
            <div className="panel-head"><div><h2 id="site-h">{t("siteTitle")}</h2></div>{byKey.has(SITE_KEY) ? <span className="status status-dev">{t("customized")}</span> : <span className="status status-neutral">{t("notSet")}</span>}</div>
            {meta(SITE_KEY)}
            <AdminDl notSet={t("notSet")} items={[
              { key: "email", label: t("contactEmail"), value: siteV.contactEmail },
              { key: "address", label: t("postalAddress"), value: siteV.postalAddress ? <span className="adm-ro-pre">{siteV.postalAddress}</span> : null },
            ]} />
          </div> : <form action={saveSite} className="panel adm-set-card" id="site">
            {hidden({ v: ver(SITE_KEY) })}
            <div className="panel-head"><div><h2 id="site-h">{t("siteTitle")}</h2><p className="small muted adm-set-sub">{t("siteLead")}</p></div>{byKey.has(SITE_KEY) ? <span className="status status-dev">{t("customized")}</span> : <span className="status status-neutral">{t("notSet")}</span>}</div>
            {meta(SITE_KEY)}
            {notice("site")}
                        <div className="adm-form-grid">
              <div className="field"><label htmlFor="ce">{t("contactEmail")} <span className="optional">({ta("optional")})</span></label><input id="ce" name="contactEmail" type="email" maxLength={254} defaultValue={siteV.contactEmail} autoComplete="off" /></div>
              <div className="field"><label htmlFor="pa">{t("postalAddress")} <span className="optional">({ta("optional")})</span></label><textarea id="pa" name="postalAddress" rows={4} maxLength={300} defaultValue={siteV.postalAddress} aria-describedby="pa-h" /><span className="hint" id="pa-h">{t("addressHint")}</span></div>
            </div>
                        {canEdit && <div className="save-row">
              {byKey.has(SITE_KEY) && resetConfirm("site-reset", t("resetSite"), t("resetSiteConfirm"))}
              <button className="btn btn-accent">{t("saveSite")}</button>
            </div>}
          </form>}
          {canEdit && byKey.has(SITE_KEY) && <form id="site-reset" action={resetSite} hidden>{hidden()}</form>}
        </section>

        {/* ── Operational policies ───────────────────────────────────────── */}
        <section className="adm-set-group" aria-labelledby="ops-h">
          {!canEdit ? <div className="panel adm-set-card is-ro" id="ops">
            <div className="panel-head"><div><h2 id="ops-h">{t("opsTitle")}</h2></div>{byKey.has(OPS_KEY) ? <span className="status status-dev">{t("customized")}</span> : <span className="status status-neutral">{t("notCustomized")}</span>}</div>
            {meta(OPS_KEY)}
            <AdminDl notSet={t("notSet")} items={[
              { key: "dir", label: t("dirDefault"), value: opsV.directoryOptInDefault === undefined ? defaultLabel(dirLabel(def.directoryOptInDefault)) : dirLabel(opsV.directoryOptInDefault) },
              { key: "tickets", label: t("paidTickets"), value: opsV.deletedUserPaidTickets ? t(`tick_${opsV.deletedUserPaidTickets}`) : defaultLabel(t(`tick_${def.deletedUserPaidTickets}`)) },
            ]} />
            <details className="adm-set-legacy" open={legacyOpen}>
              <summary>{t("legacyTitle")}</summary>
              <AdminDl notSet={t("notSet")} items={[
                { key: "ttl", label: t("ttl"), value: opsV.unpaidOrderTtlHours ?? defaultLabel(String(def.unpaidOrderTtlHours)) },
                { key: "rejected", label: t("rejected"), value: opsV.rejectedStudentPolicy ? t(`rej_${opsV.rejectedStudentPolicy}`) : defaultLabel(t(`rej_${def.rejectedStudentPolicy}`)) },
                { key: "refund", label: t("membershipRefund"), value: opsV.deletedMembershipRefund ? t(`refund_${opsV.deletedMembershipRefund}`) : defaultLabel(t(`refund_${def.deletedMembershipRefund}`)) },
              ]} />
            </details>
          </div> : <form action={saveOps} className="panel adm-set-card" id="ops">
            {hidden({ v: ver(OPS_KEY) })}
            <div className="panel-head"><div><h2 id="ops-h">{t("opsTitle")}</h2><p className="small muted adm-set-sub">{t("opsLead")}</p></div>{byKey.has(OPS_KEY) ? <span className="status status-dev">{t("customized")}</span> : <span className="status status-neutral">{t("notCustomized")}</span>}</div>
            {meta(OPS_KEY)}
            {notice("ops")}
                        <div className="adm-form-grid">
              <div className="field"><label htmlFor="od">{t("dirDefault")}</label>
                <select id="od" name="directoryOptInDefault" defaultValue={opsV.directoryOptInDefault === undefined ? "" : opsV.directoryOptInDefault ? "on" : "off"}>
                  <option value="">{defaultLabel(def.directoryOptInDefault ? t("dirOn") : t("dirOff"))}</option><option value="on">{t("dirOn")}</option><option value="off">{t("dirOff")}</option>
                </select></div>
              <div className="field"><label htmlFor="opt">{t("paidTickets")}</label>
                <select id="opt" name="deletedUserPaidTickets" defaultValue={opsV.deletedUserPaidTickets ?? ""} aria-describedby="opt-h">
                  <option value="">{defaultLabel(t(`tick_${def.deletedUserPaidTickets}`))}</option>{PAID_TICKET_POLICIES.map((v) => <option key={v} value={v}>{t(`tick_${v}`)}</option>)}
                </select><span className="hint" id="opt-h">{t("paidTicketsHint")}</span></div>
            </div>
            {/* Policies from the earlier online membership payments: membership applications take no payment now, so these only
                affect old paid orders. Kept (collapsed) so existing records are still handled; they stay saved with the form. */}
            <details className="adm-set-legacy" open={legacyOpen}>
              <summary>{t("legacyTitle")}</summary>
              <p className="small muted adm-set-sub">{t("legacyLead")}</p>
              <div className="adm-form-grid">
                <div className="field"><label htmlFor="ot">{t("ttl")}</label><input id="ot" name="unpaidOrderTtlHours" type="number" min={1} max={8760} step={1} defaultValue={opsV.unpaidOrderTtlHours ?? ""} placeholder={String(def.unpaidOrderTtlHours)} aria-describedby="ot-h" /><span className="hint" id="ot-h">{t("ttlHint", { value: def.unpaidOrderTtlHours })}</span></div>
                <div className="field"><label htmlFor="or">{t("rejected")}</label>
                  <select id="or" name="rejectedStudentPolicy" defaultValue={opsV.rejectedStudentPolicy ?? ""}>
                    <option value="">{defaultLabel(t(`rej_${def.rejectedStudentPolicy}`))}</option>{REJECTED_POLICIES.map((v) => <option key={v} value={v}>{t(`rej_${v}`)}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="omr">{t("membershipRefund")}</label>
                  <select id="omr" name="deletedMembershipRefund" defaultValue={opsV.deletedMembershipRefund ?? ""}>
                    <option value="">{defaultLabel(t(`refund_${def.deletedMembershipRefund}`))}</option>{MEMBERSHIP_REFUND_POLICIES.map((v) => <option key={v} value={v}>{t(`refund_${v}`)}</option>)}
                  </select></div>
              </div>
            </details>
                        {canEdit && <div className="save-row">
              {byKey.has(OPS_KEY) && resetConfirm("ops-reset", t("resetOps"), t("resetOpsConfirm"))}
              <button className="btn btn-accent">{t("saveOps")}</button>
            </div>}
          </form>}
          {canEdit && byKey.has(OPS_KEY) && <form id="ops-reset" action={resetOps} hidden>{hidden()}</form>}
        </section>
      </main>
    </div>
  );
}
