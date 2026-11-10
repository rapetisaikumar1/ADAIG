import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { setMessageStatus } from "./actions";
export const dynamic = "force-dynamic";

type Filter = "new" | "handled" | "all";

/** Admin inbox for the public contact form. */
export default async function AdminMessages({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ f?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("inbox"); const tc = await getTranslations("contact");
  const sp = await searchParams;
  const f: Filter = sp.f === "handled" || sp.f === "all" ? sp.f : "new";
  const [rows, counts] = await Promise.all([
    db.contactMessage.findMany({ where: f === "all" ? {} : { status: f }, orderBy: { createdAt: f === "new" ? "asc" : "desc" }, take: 200 }),
    db.contactMessage.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  const et = (await getTranslations("admin"))("et");
  const fmt = (d: Date) => `${d.toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${et}`;
  const tab = (k: Filter, label: string, count: number) => (
    <a href={`/${locale}/admin/messages?f=${k}`} aria-current={f === k ? "page" : undefined}>{label} <span className="adm-n">{count}</span></a>
  );
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/messages" />
      <main id="main" className="app-main inbox">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="muted inbox-lead">{t("lead")}</p></div>
          <a className="btn btn-secondary btn-sm" href={`/api/admin/messages.csv${f === "all" ? "" : `?f=${f}`}`} download>{t("exportCsv")}</a></div>
        {sp.msg === "handled" && <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}><div>{t("msgHandled")}</div></div>}
        {sp.msg === "reopened" && <div className="alert alert-info" role="status" style={{ marginBottom: 16 }}><div>{t("msgReopened")}</div></div>}
        <div className="adm-toolbar"><nav className="adm-filters" aria-label={t("filters")}>{tab("new", t("tabNew"), n("new"))}{tab("handled", t("tabHandled"), n("handled"))}{tab("all", t("tabAll"), total)}</nav></div>
        {rows.length === 0 ? (
          <div className="adm-empty"><p><b>{f === "new" ? t("emptyNewTitle") : t("emptyTitle")}</b><br />{t("emptyBody")}</p></div>
        ) : (
          <ul className="inbox-list">
            {rows.map((m) => (
              <li key={m.id} className={`card inbox-item${m.status === "new" ? " is-new" : ""}`}>
                <div className="inbox-meta">
                  <span className="badge">{tc(`topic_${m.topic}` as "topic_other")}</span>
                  <span className={`badge ${m.status === "new" ? "badge-amber" : "badge-green"}`}>{m.status === "new" ? t("statusNew") : t("statusHandled")}</span>
                  {m.userId && <span className="badge">{t("signedIn")}</span>}
                  <span className="small muted">{fmt(m.createdAt)}{m.locale === "fr" ? " · FR" : ""}</span>
                </div>
                <h2 className="inbox-from">{m.name}{m.organization ? <span className="muted"> · {m.organization}</span> : null}</h2>
                <p className="small"><a href={`mailto:${encodeURIComponent(m.email).replace("%40", "@")}?subject=${encodeURIComponent(`ADAIG — ${tc(`topic_${m.topic}` as "topic_other")}`)}`}>{m.email}</a></p>
                <p className="inbox-body">{m.message}</p>
                <div className="inbox-actions">
                  <a className="btn btn-secondary btn-sm" href={`mailto:${encodeURIComponent(m.email).replace("%40", "@")}?subject=${encodeURIComponent(`ADAIG — ${tc(`topic_${m.topic}` as "topic_other")}`)}`}>{t("reply")}</a>
                  <form action={setMessageStatus}>
                    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="f" value={f} />
                    <input type="hidden" name="to" value={m.status === "new" ? "handled" : "new"} />
                    <button className={`btn btn-sm ${m.status === "new" ? "btn-accent" : "btn-secondary"}`}>{m.status === "new" ? t("markHandled") : t("reopen")}</button>
                  </form>
                  {m.handledAt && <span className="small muted">{t("handledOn", { date: fmt(m.handledAt) })}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
