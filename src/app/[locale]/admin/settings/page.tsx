import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { type Locale } from "@/config/site";
import { eventTimeZone, dateLocale } from "@/lib/time";
import {
  SITE_KEY, OPS_KEY, tierKey, resolveTiers, opsSchema, siteSchema, opsDefaults,
  REJECTED_POLICIES, PAID_TICKET_POLICIES, MEMBERSHIP_REFUND_POLICIES,
} from "@/lib/settings";
import { saveTier, resetTier, resetAllTiers, saveSite, saveOps, resetSite, resetOps } from "./actions";
export const dynamic = "force-dynamic";

const MSGS: Record<string, "alert-success" | "alert-danger"> = {
  saved: "alert-success", reset: "alert-success", invalid: "alert-danger", benefitsMismatch: "alert-danger", lastVisible: "alert-danger",
  conflict: "alert-danger", invalidEmail: "alert-danger",
};

/** Admin → Settings: membership tiers, public contact details, operational policies (Setting table; missing row = default). */
export default async function AdminSettings({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ msg?: string; s?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("adminSettings"); const ta = await getTranslations("admin");
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
    ? <div className={`alert ${MSGS[msg]}`} role={MSGS[msg] === "alert-danger" ? "alert" : "status"}><div>{t(`msg_${msg}`)}</div></div> : null;
  const hidden = (extra?: Record<string, string>) => (
    <><input type="hidden" name="locale" value={locale} />{Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>
  );
  const h2 = { fontSize: "var(--fs-xl)", margin: 0 } as const;
  const h3 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  // "Default: keep the seat (anonymized)": the option label is lower-cased after the colon (no nested parentheses).
  const defaultLabel = (v: string) => t("useDefault", { value: v.charAt(0).toLocaleLowerCase(locale) + v.slice(1) });
  /** Same height for an EN/FR pair of textareas: rough count of wrapped lines (≈44 characters per line) of the longer text. */
  const pairRows = (texts: string[], min: number, max: number) => {
    const lines = (s: string) => s.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 44)), 0);
    return Math.min(max, Math.max(min, ...texts.map((x) => lines(x) + 1)));
  };
  /** "Reset" with a confirm step. The confirm button submits a separate reset form (forms can't be nested), placed after the card. */
  const resetConfirm = (formId: string, label: string, text: string) => (
    <details className="adm-confirm adm-set-reset"><summary className="btn btn-ghost btn-sm">{label}…</summary>
      <div className="adm-confirm-box"><p className="small" style={{ margin: 0 }}>{text}</p><button type="submit" form={formId} className="btn btn-danger btn-sm">{t("resetYes")}</button></div>
    </details>
  );
  const legacyOpen = opsV.unpaidOrderTtlHours !== undefined || opsV.rejectedStudentPolicy !== undefined || opsV.deletedMembershipRefund !== undefined;

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/settings" />
      <main id="main" className="app-main adm-settings">
        <div className="app-head"><div><span className="eyebrow">{ta("eyebrowOps")}</span><h1>{t("title")}</h1><p className="muted adm-set-lead">{t("lead")}</p></div></div>
        <nav className="adm-set-jump small" aria-label={t("jump")}><a href="#tiers">{t("tiersTitle")}</a><a href="#site">{t("siteTitle")}</a><a href="#ops">{t("opsTitle")}</a></nav>

        {/* ── Membership tiers ───────────────────────────────────────────── */}
        <section className="adm-section" id="tiers" aria-labelledby="tiers-h">
          <div className="adm-card-head adm-set-head">
            <div><h2 id="tiers-h" style={h2}>{t("tiersTitle")}</h2><p className="small muted adm-set-sub">{t("tiersLead")}</p></div>
            {tiers.some((x) => x.overridden) && (
              <details className="adm-confirm"><summary className="btn btn-danger-outline btn-sm">{t("resetAll")}…</summary>
                <form action={resetAllTiers}>{hidden()}<p className="small" style={{ margin: 0 }}>{t("resetAllConfirm")}</p><button className="btn btn-danger btn-sm">{t("confirmYes")}</button></form>
              </details>
            )}
          </div>
          {notice("tiers")}
          <div className="adm-set-list">
            {tiers.map((tier) => {
              const key = tierKey(tier.id); const anchor = key.replace(/\./g, "-"); const p = `t-${tier.id}`;
              const benEn = tier.benefits.map((b) => b.en).join("\n"), benFr = tier.benefits.map((b) => b.fr).join("\n");
              const descRows = pairRows([tier.description.en, tier.description.fr], 3, 8), benRows = pairRows([benEn, benFr], 5, 16);
              return (
                [<form key={tier.id} action={saveTier} className="card adm-form adm-set-card" id={anchor} aria-labelledby={`${p}-h`}>
                  {hidden({ id: tier.id, v: ver(key) })}
                  <div className="adm-card-head">
                    <h3 id={`${p}-h`} style={h3}>{tier.name[locale]} <span className="adm-set-id">{t("tierId", { id: tier.id })}</span></h3>
                    <div className="adm-actions">
                      {tier.overridden ? <span className="badge badge-amber">{t("customized")}</span> : <span className="badge">{t("notCustomized")}</span>}
                      {!tier.visible && <span className="badge badge-red">{t("hiddenBadge")}</span>}
                      {tier.featured && <span className="badge badge-navy">{t("featuredBadge")}</span>}
                    </div>
                  </div>
                  {meta(key)}
                  {notice(anchor)}
                  <div className="grid g2" style={{ gap: "0 16px" }}>
                    <div className="field"><label htmlFor={`${p}-ne`}>{t("nameEn")}</label><input id={`${p}-ne`} name="nameEn" type="text" required maxLength={60} defaultValue={tier.name.en} /></div>
                    <div className="field"><label htmlFor={`${p}-nf`}>{t("nameFr")}</label><input id={`${p}-nf`} name="nameFr" type="text" required maxLength={60} defaultValue={tier.name.fr} lang="fr" /></div>
                    <div className="field"><label htmlFor={`${p}-de`}>{t("descEn")}</label><textarea id={`${p}-de`} name="descEn" required rows={descRows} maxLength={300} defaultValue={tier.description.en} /></div>
                    <div className="field"><label htmlFor={`${p}-df`}>{t("descFr")}</label><textarea id={`${p}-df`} name="descFr" required rows={descRows} maxLength={300} defaultValue={tier.description.fr} lang="fr" /></div>
                    <div className="field"><label htmlFor={`${p}-be`}>{t("benefitsEn")}</label><textarea id={`${p}-be`} name="benefitsEn" required rows={benRows} defaultValue={benEn} aria-describedby={`${p}-bh`} /></div>
                    <div className="field"><label htmlFor={`${p}-bf`}>{t("benefitsFr")}</label><textarea id={`${p}-bf`} name="benefitsFr" required rows={benRows} defaultValue={benFr} aria-describedby={`${p}-bh`} lang="fr" /></div>
                  </div>
                  <p className="hint adm-set-hint" id={`${p}-bh`}>{t("benefitsHint")}</p>
                  <div className="grid g2 adm-set-flags" style={{ gap: "0 16px" }}>
                    <div className="field"><label htmlFor={`${p}-o`}>{t("order")}</label><input id={`${p}-o`} name="order" type="number" min={1} max={99} step={1} required defaultValue={tier.order} aria-describedby={`${p}-oh`} /><span className="hint" id={`${p}-oh`}>{t("orderHint")}</span></div>
                    <div className="adm-set-checks">
                      <label className="check"><input type="checkbox" name="visible" defaultChecked={tier.visible} aria-describedby={`${p}-vh`} /> <span>{t("visible")}</span></label>
                      <span className="hint" id={`${p}-vh`}>{t("visibleHint")}</span>
                      <label className="check"><input type="checkbox" name="featured" defaultChecked={!!tier.featured} /> <span>{t("featured")}</span></label>
                      <label className="check"><input type="checkbox" name="requiresVerification" defaultChecked={!!tier.requiresVerification} /> <span>{t("requiresVerification")}</span></label>
                    </div>
                  </div>
                  <div className="adm-form-foot">
                    {tier.overridden ? resetConfirm(`${anchor}-reset`, t("resetTier"), t("resetTierConfirm", { name: tier.name[locale] })) : <span />}
                    <button className="btn btn-accent">{t("saveTier")}</button>
                  </div>
                </form>,
                tier.overridden && <form key={`${tier.id}-reset`} id={`${anchor}-reset`} action={resetTier} hidden>{hidden({ id: tier.id })}</form>,
              ]);
            })}
          </div>
        </section>

        {/* ── Public contact details ─────────────────────────────────────── */}
        <section className="adm-section" aria-labelledby="site-h">
          <form action={saveSite} className="card adm-form adm-set-card" id="site">
            {hidden({ v: ver(SITE_KEY) })}
            <div className="adm-card-head"><h2 id="site-h" style={h2}>{t("siteTitle")}</h2>{byKey.has(SITE_KEY) ? <span className="badge badge-amber">{t("customized")}</span> : <span className="badge">{t("notSet")}</span>}</div>
            <p className="small muted adm-set-sub">{t("siteLead")}</p>
            {meta(SITE_KEY)}
            {notice("site")}
            <div className="grid g2" style={{ gap: "0 16px" }}>
              <div className="field"><label htmlFor="ce">{t("contactEmail")} <span className="hint">({ta("optional")})</span></label><input id="ce" name="contactEmail" type="email" maxLength={254} defaultValue={siteV.contactEmail} autoComplete="off" /></div>
              <div className="field"><label htmlFor="pa">{t("postalAddress")} <span className="hint">({ta("optional")})</span></label><textarea id="pa" name="postalAddress" rows={4} maxLength={300} defaultValue={siteV.postalAddress} aria-describedby="pa-h" /><span className="hint" id="pa-h">{t("addressHint")}</span></div>
            </div>
            <div className="adm-form-foot">
              {byKey.has(SITE_KEY) ? resetConfirm("site-reset", t("resetSite"), t("resetSiteConfirm")) : <span />}
              <button className="btn btn-accent">{t("saveSite")}</button>
            </div>
          </form>
          {byKey.has(SITE_KEY) && <form id="site-reset" action={resetSite} hidden>{hidden()}</form>}
        </section>

        {/* ── Operational policies ───────────────────────────────────────── */}
        <section className="adm-section" aria-labelledby="ops-h">
          <form action={saveOps} className="card adm-form adm-set-card" id="ops">
            {hidden({ v: ver(OPS_KEY) })}
            <div className="adm-card-head"><h2 id="ops-h" style={h2}>{t("opsTitle")}</h2>{byKey.has(OPS_KEY) ? <span className="badge badge-amber">{t("customized")}</span> : <span className="badge">{t("notCustomized")}</span>}</div>
            <p className="small muted adm-set-sub">{t("opsLead")}</p>
            {meta(OPS_KEY)}
            {notice("ops")}
            <div className="grid g2" style={{ gap: "0 16px" }}>
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
              <p className="small muted" style={{ margin: "8px 0 12px" }}>{t("legacyLead")}</p>
              <div className="grid g2" style={{ gap: "0 16px" }}>
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
            <div className="adm-form-foot">
              {byKey.has(OPS_KEY) ? resetConfirm("ops-reset", t("resetOps"), t("resetOpsConfirm")) : <span />}
              <button className="btn btn-accent">{t("saveOps")}</button>
            </div>
          </form>
          {byKey.has(OPS_KEY) && <form id="ops-reset" action={resetOps} hidden>{hidden()}</form>}
        </section>
      </main>
    </div>
  );
}
