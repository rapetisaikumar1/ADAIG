import { evLabel } from "@/config/site";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { createEvent, togglePublish } from "./actions";
export const dynamic = "force-dynamic";

export default async function AdminEvents({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin");
  const events = await db.event.findMany({ include: { _count: { select: { registrations: { where: { status: "confirmed" } } } } }, orderBy: { startsAt: "asc" } });
  return (
    <div className="app"><AdminNav locale={locale} current="/admin/events" />
      <main id="main" className="app-main">
        <div className="app-head"><h1>{t("events")}</h1></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")} style={{ marginBottom: 24 }}><table><thead><tr><th scope="col">{t("date")}</th><th scope="col">{t("evTitle")}</th><th scope="col">{t("type")}</th><th scope="col">FPC/CPE</th><th scope="col">{t("regs2")}</th><th scope="col">{t("status")}</th></tr></thead><tbody>
          {events.map((e) => <tr key={e.id}><td>{e.startsAt.toISOString().slice(0, 10)}</td><td><a href={`/${locale}/events/${e.slug}`}>{e.title}</a></td><td>{evLabel(e.type, locale)}</td><td>{e.cpe}</td><td>{e._count.registrations}</td><td><form action={togglePublish}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-ghost btn-sm">{e.published ? t("published") : t("draft")}</button></form></td></tr>)}
        </tbody></table></div>
        <form action={createEvent} className="card" style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: "var(--fs-lg)" }}>{t("newEvent")}</h2><input type="hidden" name="locale" value={locale} />
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="ti">{t("titleEn")}</label><input type="text" id="ti" name="title" required /></div>
            <div className="field"><label htmlFor="tf">{t("titleFr")}</label><input type="text" id="tf" name="titleFr" /></div>
          </div>
          <div className="field"><label htmlFor="su">{t("summary")}</label><textarea id="su" name="summary" required rows={3} /></div>
          <div className="grid g2" style={{ gap: "0 16px" }}>
            <div className="field"><label htmlFor="ty">{t("type")}</label><select id="ty" name="type">{["Webinar", "Chapter", "Conference"].map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
            <div className="field"><label htmlFor="fo">{t("format")}</label><select id="fo" name="format">{["Online", "In person", "Hybrid"].map((v) => <option key={v} value={v}>{evLabel(v, locale)}</option>)}</select></div>
            <div className="field"><label htmlFor="st">{t("startsAt")}</label><input id="st" name="startsAt" type="datetime-local" required /></div>
            <div className="field"><label htmlFor="lo">{t("location")}</label><input type="text" id="lo" name="location" /></div>
            <div className="field"><label htmlFor="du">{t("duration")}</label><input id="du" name="durationMin" type="number" defaultValue={60} required /></div>
            <div className="field"><label htmlFor="cp">CPE</label><input id="cp" name="cpe" type="number" step="0.5" defaultValue={1} required /></div>
            <div className="field"><label htmlFor="mp">{t("memberPrice")}</label><input id="mp" name="memberPrice" type="number" step="0.01" defaultValue={0} /></div>
            <div className="field"><label htmlFor="pp">{t("publicPrice")}</label><input id="pp" name="publicPrice" type="number" step="0.01" /></div>
          </div>
          <button className="btn btn-accent">{t("create")}</button>
        </form>
      </main>
    </div>
  );
}
