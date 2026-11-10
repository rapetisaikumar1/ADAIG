import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { type Locale } from "@/config/site";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
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
  const defaultLabel = (v: string) => t("useDefault", { value: v });

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/settings" />
      <main id="main" className="app-main adm-settings">
        <div className="app-head"><div><span className="eyebrow">{ta("eyebrow")}</span><h1>{t("title")}</h1><p className="muted adm-set-lead">{t("lead")}</p></div></div>
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
              return (
                <form key={tier.id} action={saveTier} className="card adm-form adm-set-card" id={anchor} aria-labelledby={`${p}-h`}>
                  {hidden({ id: tier.id, v: ver(key) })}
                  <div className="adm-card-head">
                    <h3 id={`${p}-h`} style={h3}>{tier.name[locale]} <code className="adm-set-id">{tier.id}</code></h3>
                    <div className="adm-actions">
                      {tier.overridden ? <span className="badge badge-amber">{t("customized")}</span> : <span className="badge">{t("default")}</span>}
                      {!tier.visible && <span className="badge badge-red">{t("hiddenBadge")}</span>}
                      {tier.featured && <span className="badge badge-navy">{t("featuredBadge")}</span>}
                    </div>
                  </div>
                  {meta(key)}
                  {notice(anchor)}
                  <div className="grid g2" style={{ gap: "0 16px" }}>
                    <div className="field"><label htmlFor={`${p}-ne`}>{t("nameEn")}</label><input id={`${p}-ne`} name="nameEn" type="text" required maxLength={60} defaultValue={tier.name.en} /></div>
                    <div className="field"><label htmlFor={`${p}-nf`}>{t("nameFr")}</label><input id={`${p}-nf`} name="nameFr" type="text" required maxLength={60} defaultValue={tier.name.fr} lang="fr" /></div>
                    <div className="field"><label htmlFor={`${p}-de`}>{t("descEn")}</label><textarea id={`${p}-de`} name="descEn" required rows={2} maxLength={300} defaultValue={tier.description.en} /></div>
                    <div className="field"><label htmlFor={`${p}-df`}>{t("descFr")}</label><textarea id={`${p}-df`} name="descFr" required rows={2} maxLength={300} defaultValue={tier.description.fr} lang="fr" /></div>
                    <div className="field"><label htmlFor={`${p}-be`}>{t("benefitsEn")}</label><textarea id={`${p}-be`} name="benefitsEn" required rows={Math.max(4, tier.benefits.length + 1)} defaultValue={tier.benefits.map((b) => b.en).join("\n")} aria-describedby={`${p}-bh`} /></div>
                    <div className="field"><label htmlFor={`${p}-bf`}>{t("benefitsFr")}</label><textarea id={`${p}-bf`} name="benefitsFr" required rows={Math.max(5, tier.benefits.length + 2)} defaultValue={tier.benefits.map((b) => b.fr).join("\n")} aria-describedby={`${p}-bh`} lang="fr" /></div>
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
                    {tier.overridden ? <button className="btn btn-ghost btn-sm" formAction={resetTier} formNoValidate>{t("resetTier")}</button> : <span />}
                    <button className="btn btn-accent">{t("saveTier")}</button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>

        {/* ── Public contact details ─────────────────────────────────────── */}
        <section className="adm-section" aria-labelledby="site-h">
          <form action={saveSite} className="card adm-form adm-set-card" id="site">
            {hidden({ v: ver(SITE_KEY) })}
            <div className="adm-card-head"><h2 id="site-h" style={h2}>{t("siteTitle")}</h2>{byKey.has(SITE_KEY) ? <span className="badge badge-amber">{t("customized")}</span> : <span className="badge">{t("default")}</span>}</div>
            <p className="small muted adm-set-sub">{t("siteLead")}</p>
            {meta(SITE_KEY)}
            {notice("site")}
            <div className="grid g2" style={{ gap: "0 16px" }}>
              <div className="field"><label htmlFor="ce">{t("contactEmail")} <span className="hint">({ta("optional")})</span></label><input id="ce" name="contactEmail" type="email" maxLength={254} defaultValue={siteV.contactEmail} autoComplete="off" /></div>
              <div className="field"><label htmlFor="pa">{t("postalAddress")} <span className="hint">({ta("optional")})</span></label><textarea id="pa" name="postalAddress" rows={4} maxLength={300} defaultValue={siteV.postalAddress} aria-describedby="pa-h" /><span className="hint" id="pa-h">{t("addressHint")}</span></div>
            </div>
            <div className="adm-form-foot">
              {byKey.has(SITE_KEY) ? <button className="btn btn-ghost btn-sm" formAction={resetSite} formNoValidate>{t("resetSite")}</button> : <span />}
              <button className="btn btn-accent">{t("saveSite")}</button>
            </div>
          </form>
        </section>

        {/* ── Operational policies ───────────────────────────────────────── */}
        <section className="adm-section" aria-labelledby="ops-h">
          <form action={saveOps} className="card adm-form adm-set-card" id="ops">
            {hidden({ v: ver(OPS_KEY) })}
            <div className="adm-card-head"><h2 id="ops-h" style={h2}>{t("opsTitle")}</h2>{byKey.has(OPS_KEY) ? <span className="badge badge-amber">{t("customized")}</span> : <span className="badge">{t("default")}</span>}</div>
            <p className="small muted adm-set-sub">{t("opsLead")}</p>
            {meta(OPS_KEY)}
            {notice("ops")}
            <div className="grid g2" style={{ gap: "0 16px" }}>
              <div className="field"><label htmlFor="od">{t("dirDefault")}</label>
                <select id="od" name="directoryOptInDefault" defaultValue={opsV.directoryOptInDefault === undefined ? "" : opsV.directoryOptInDefault ? "on" : "off"}>
                  <option value="">{defaultLabel(def.directoryOptInDefault ? t("dirOn") : t("dirOff"))}</option><option value="on">{t("dirOn")}</option><option value="off">{t("dirOff")}</option>
                </select></div>
              <div className="field"><label htmlFor="ot">{t("ttl")}</label><input id="ot" name="unpaidOrderTtlHours" type="number" min={1} max={8760} step={1} defaultValue={opsV.unpaidOrderTtlHours ?? ""} placeholder={String(def.unpaidOrderTtlHours)} aria-describedby="ot-h" /><span className="hint" id="ot-h">{t("ttlHint", { value: def.unpaidOrderTtlHours })}</span></div>
              <div className="field"><label htmlFor="or">{t("rejected")}</label>
                <select id="or" name="rejectedStudentPolicy" defaultValue={opsV.rejectedStudentPolicy ?? ""}>
                  <option value="">{defaultLabel(t(`rej_${def.rejectedStudentPolicy}`))}</option>{REJECTED_POLICIES.map((v) => <option key={v} value={v}>{t(`rej_${v}`)}</option>)}
                </select></div>
              <div className="field"><label htmlFor="opt">{t("paidTickets")}</label>
                <select id="opt" name="deletedUserPaidTickets" defaultValue={opsV.deletedUserPaidTickets ?? ""}>
                  <option value="">{defaultLabel(t(`tick_${def.deletedUserPaidTickets}`))}</option>{PAID_TICKET_POLICIES.map((v) => <option key={v} value={v}>{t(`tick_${v}`)}</option>)}
                </select></div>
              <div className="field"><label htmlFor="omr">{t("membershipRefund")}</label>
                <select id="omr" name="deletedMembershipRefund" defaultValue={opsV.deletedMembershipRefund ?? ""}>
                  <option value="">{defaultLabel(t(`refund_${def.deletedMembershipRefund}`))}</option>{MEMBERSHIP_REFUND_POLICIES.map((v) => <option key={v} value={v}>{t(`refund_${v}`)}</option>)}
                </select></div>
            </div>
            <div className="adm-form-foot">
              {byKey.has(OPS_KEY) ? <button className="btn btn-ghost btn-sm" formAction={resetOps} formNoValidate>{t("resetOps")}</button> : <span />}
              <button className="btn btn-accent">{t("saveOps")}</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
