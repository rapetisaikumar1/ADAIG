import { evLabel } from "@/config/site";
import { getTranslations } from "next-intl/server";
import type { Event } from "@/generated/prisma/client";
import { EVENT_TYPES, EVENT_FORMATS, toEventLocal } from "./eventForm";

const legend = { font: "700 var(--fs-xs) var(--font-body)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--slate-500)", margin: "8px 0 12px" } as const;
export const formLegend = legend;
const money = (c: number | null) => (c === null ? undefined : (c / 100).toFixed(2).replace(/\.00$/, ""));

/**
 * Event fields shared by "New event" (no `e`: same markup and defaults as before) and the edit page (`e` prefills every field;
 * the start time is shown in ET, the zone it is entered in). `idp` prefixes element ids so both forms can share a page.
 */
export async function EventFields({ locale, e, idp = "" }: { locale: string; e?: Event; idp?: string }) {
  const t = await getTranslations("admin");
  const id = (s: string) => `${idp}${s}`;
  return (
    <>
      <h3 style={legend}>{t("secDetails")}</h3>
      <div className="grid g2" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor={id("ti")}>{t("titleEn")}</label><input type="text" id={id("ti")} name="title" required maxLength={200} defaultValue={e?.title} /></div>
        <div className="field"><label htmlFor={id("tf")}>{t("titleFr")} <span className="hint">({t("optional")})</span></label><input type="text" id={id("tf")} name="titleFr" maxLength={200} defaultValue={e?.titleFr ?? undefined} /></div>
      </div>
      <div className="field"><label htmlFor={id("su")}>{t("summary")}</label><textarea id={id("su")} name="summary" required rows={3} maxLength={2000} defaultValue={e?.summary} /></div>
      <div className="field"><label htmlFor={id("suf")}>{t("summaryFr")} <span className="hint">({t("optional")})</span></label><textarea id={id("suf")} name="summaryFr" rows={3} maxLength={2000} defaultValue={e?.summaryFr ?? undefined} /></div>
      <h3 style={legend}>{t("secWhen")}</h3>
      <div className="grid g3" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor={id("ty")}>{t("type")}</label><select id={id("ty")} name="type" defaultValue={e?.type}>{EVENT_TYPES.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
        <div className="field"><label htmlFor={id("fo")}>{t("format")}</label><select id={id("fo")} name="format" defaultValue={e?.format}>{EVENT_FORMATS.map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
        <div className="field"><label htmlFor={id("lo")}>{t("location")} <span className="hint">({t("optional")})</span></label><input type="text" id={id("lo")} name="location" maxLength={200} defaultValue={e?.location ?? undefined} /></div>
        <div className="field"><label htmlFor={id("st")}>{t("startsAt")} <span className="hint">({t("et")})</span></label><input id={id("st")} name="startsAt" type="datetime-local" required aria-describedby={id("st-h")} defaultValue={e ? toEventLocal(e.startsAt) : undefined} /><span className="hint" id={id("st-h")}>{t("startsAtHint")}</span></div>
        <div className="field"><label htmlFor={id("du")}>{t("duration")}</label><input id={id("du")} name="durationMin" type="number" min={1} defaultValue={e?.durationMin ?? 60} required /></div>
      </div>
      <h3 style={legend}>{t("secCpePrice")}</h3>
      <div className="grid g3" style={{ gap: "0 16px" }}>
        <div className="field"><label htmlFor={id("cp")}>{t("cpeHours")}</label><input id={id("cp")} name="cpe" type="number" step="0.5" min={0} defaultValue={e?.cpe ?? 1} required /></div>
        <div className="field"><label htmlFor={id("mp")}>{t("memberPrice")}</label><input id={id("mp")} name="memberPrice" type="number" step="0.01" min={0} defaultValue={e ? money(e.memberPriceCents) : 0} /></div>
        <div className="field"><label htmlFor={id("pp")}>{t("publicPrice")}</label><input id={id("pp")} name="publicPrice" type="number" step="0.01" min={0} aria-describedby={id("pp-h")} defaultValue={e ? money(e.publicPriceCents) : undefined} /><span className="hint" id={id("pp-h")}>{t("publicPriceHint")}</span></div>
      </div>
    </>
  );
}
