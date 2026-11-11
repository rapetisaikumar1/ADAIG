import { evLabel } from "@/config/site";
import { getTranslations } from "next-intl/server";
import type { Event } from "@/generated/prisma/client";
import { isUnconfirmed, stripStatus } from "@/components/EventCard";
import { EVENT_TYPES, EVENT_FORMATS, toEventLocal } from "./eventForm";

const money = (c: number | null) => (c === null ? undefined : (c / 100).toFixed(2).replace(/\.00$/, ""));

/**
 * Event fields shared by "New event" (no `e`: same markup and defaults as before) and the edit page (`e` prefills every field;
 * the start time is shown in ET, the zone it is entered in). `idp` prefixes element ids so both forms can share a page.
 * Rendered as settings-style sections (DESIGN_R5 §10.4): section title left, fields right; h3 under the form's h2.
 */
export async function EventFields({ locale, e, idp = "" }: { locale: string; e?: Event; idp?: string }) {
  const t = await getTranslations("admin"); const te = await getTranslations("adminEvents");
  const id = (s: string) => `${idp}${s}`;
  const sec = (title: string, body: React.ReactNode, desc?: React.ReactNode) => (
    <div className="settings-section"><header><h3>{title}</h3>{desc}</header><div className="adm-fields">{body}</div></div>
  );
  return (
    <>
      {/* French texts are not offered in the form (client, round 6b) but kept: the edit form re-submits the stored values
          unchanged (same values the visible fields used to prefill), so saving never clears them. "New event" sends none
          (empty = no French text, as before). */}
      {e && <>
        <input type="hidden" name="titleFr" value={e.titleFr ? stripStatus(e.titleFr) : ""} />
        <input type="hidden" name="summaryFr" value={e.summaryFr ?? ""} />
        <input type="hidden" name="accessInfoFr" value={e.accessInfoFr ?? ""} />
      </>}
      {sec(t("secDetails"), <>
        <div className="adm-form-grid">
          <div className="field span-all"><label htmlFor={id("ti")}>{t("titleEn")}</label><input type="text" id={id("ti")} name="title" required maxLength={189} defaultValue={e ? stripStatus(e.title) : undefined} /><span className="error-msg" id={`${id("ti")}-err`} hidden /></div>
          <div className="field span-all"><label htmlFor={id("su")}>{t("summary")}</label><textarea id={id("su")} name="summary" required rows={3} maxLength={2000} defaultValue={e?.summary} /><span className="error-msg" id={`${id("su")}-err`} hidden /></div>
        </div>
        <div className="field">
          <label className="check"><input type="checkbox" id={id("pr")} name="proposed" defaultChecked={e ? isUnconfirmed(e) : false} aria-describedby={id("pr-h")} /> <span>{te("proposedLabel")}</span></label>
          <span className="hint" id={id("pr-h")} style={{ paddingLeft: 30 }}>{te("proposedFieldHint")}</span>
        </div>
      </>)}
      {sec(t("secWhen"), <div className="adm-form-grid is-3">
        <div className="field"><label htmlFor={id("ty")}>{t("type")}</label><select id={id("ty")} name="type" defaultValue={e?.type}>{EVENT_TYPES.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
        <div className="field"><label htmlFor={id("fo")}>{t("format")}</label><select id={id("fo")} name="format" defaultValue={e?.format}>{EVENT_FORMATS.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
        <div className="field"><label htmlFor={id("lo")}>{t("location")} <span className="optional">({t("optional")})</span></label><input type="text" id={id("lo")} name="location" maxLength={200} defaultValue={e?.location ?? undefined} /></div>
        <div className="field"><label htmlFor={id("st")}>{t("startsAt")} <span className="optional">({t("et")})</span></label><input id={id("st")} name="startsAt" type="datetime-local" required aria-describedby={id("st-h")} defaultValue={e ? toEventLocal(e.startsAt) : undefined} /><span className="error-msg" id={`${id("st")}-err`} hidden /><span className="hint" id={id("st-h")}>{t("startsAtHint")}</span></div>
        <div className="field"><label htmlFor={id("du")}>{t("duration")}</label><input id={id("du")} name="durationMin" type="number" min={1} max={20160} defaultValue={e?.durationMin ?? 60} required /><span className="error-msg" id={`${id("du")}-err`} hidden /></div>
      </div>)}
      {sec(t("secCpePrice"), <div className="adm-form-grid is-3">
        <div className="field"><label htmlFor={id("cp")}>{t("cpeHours")}</label><input id={id("cp")} name="cpe" type="number" step="0.5" min={0} max={100} defaultValue={e?.cpe ?? 1} required aria-describedby={id("cp-h")} /><span className="error-msg" id={`${id("cp")}-err`} hidden /><span className="hint" id={id("cp-h")}>{te("cpeHint")}</span></div>
        <div className="field"><label htmlFor={id("mp")}>{t("memberPrice")}</label><input id={id("mp")} name="memberPrice" type="number" step="0.01" min={0} max={100000} defaultValue={e ? money(e.memberPriceCents) : 0} /><span className="error-msg" id={`${id("mp")}-err`} hidden /></div>
        <div className="field"><label htmlFor={id("pp")}>{t("publicPrice")}</label><input id={id("pp")} name="publicPrice" type="number" step="0.01" min={0} max={100000} aria-describedby={id("pp-h")} defaultValue={e ? money(e.publicPriceCents) : undefined} /><span className="error-msg" id={`${id("pp")}-err`} hidden /><span className="hint" id={id("pp-h")}>{t("publicPriceHint")}</span></div>
      </div>)}
      {sec(te("secAccess"), <div className="adm-form-grid">
        <div className="field span-all"><label htmlFor={id("ai")}>{te("accessInfo")} <span className="optional">({t("optional")})</span></label><textarea id={id("ai")} name="accessInfo" rows={4} maxLength={2000} aria-describedby={id("ai-h")} defaultValue={e?.accessInfo ?? undefined} /></div>
      </div>, <p id={id("ai-h")}>{te("accessInfoHint")}</p>)}
    </>
  );
}
