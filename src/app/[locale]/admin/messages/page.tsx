import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdminPermission, can } from "@/lib/rbac";
import { AdminNav } from "@/components/AppShell";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Facet";
import { AdminHead, AdminTabs, AdminEmpty, AdminReadOnly, type TabItem } from "../_components/AdminUI";
import { eventTimeZone, dateLocale } from "@/lib/time";
import { setMessageStatus } from "./actions";
export const dynamic = "force-dynamic";

type Filter = "new" | "handled" | "all";

/** Admin inbox for the public contact form. */
export default async function AdminMessages({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ f?: string; msg?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const ctx = await requireAdminPermission(locale, "messages", "view");
  const canEdit = can(ctx, "messages", "edit"); // mark handled / reopen; the CSV export needs only messages.view
  const t = await getTranslations("inbox"); const tc = await getTranslations("contact");
  const sp = await searchParams;
  const f: Filter = sp.f === "handled" || sp.f === "all" ? sp.f : "new";
  const [rows, counts] = await Promise.all([
    db.contactMessage.findMany({ where: f === "all" ? {} : { status: f }, orderBy: { createdAt: f === "new" ? "asc" : "desc" }, take: 200 }),
    db.contactMessage.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  const ta = await getTranslations("admin"); const et = ta("et");
  const fmt = (d: Date) => `${d.toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${et}`;
  const tabs: TabItem[] = ([["new", t("tabNew"), n("new")], ["handled", t("tabHandled"), n("handled")], ["all", t("tabAll"), total]] as const)
    .map(([k, label, count]) => ({ key: k, href: `/${locale}/admin/messages?f=${k}`, label, count, current: f === k }));
  const mailto = (m: { email: string; topic: string }) => `mailto:${encodeURIComponent(m.email).replace("%40", "@")}?subject=${encodeURIComponent(`ADAIG — ${tc(`topic_${m.topic}` as "topic_other")}`)}`;
  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/messages" />
      <main id="main" tabIndex={-1} className="app-main inbox">
        {/* Export only when there is something to export (VPo-14). */}
        <AdminHead title={t("title")} lead={canEdit ? t("lead") : t("leadRO")}
          actions={total > 0 ? <a className="btn btn-secondary btn-sm" href={`/api/admin/messages.csv${f === "all" ? "" : `?f=${f}`}`} download><Icon name="download" size={16} />{t("exportCsv")}</a> : undefined} />
        {sp.msg === "handled" && <FocusOnLoad><div className="alert alert-success adm-notice" role="status"><div>{t("msgHandled")}</div></div></FocusOnLoad>}
        {sp.msg === "reopened" && <FocusOnLoad><div className="alert alert-info adm-notice" role="status"><div>{t("msgReopened")}</div></div></FocusOnLoad>}
        {!canEdit && <AdminReadOnly text={ta("readOnly")} />}
        <AdminTabs label={t("filters")} items={tabs} />
        {rows.length === 0 ? (
          <AdminEmpty title={f === "new" ? t("emptyNewTitle") : t("emptyTitle")}>{t("emptyBody")}</AdminEmpty>
        ) : (
          <ul className="inbox-list">
            {rows.map((m) => (
              <li key={m.id} className={`inbox-item${m.status === "new" ? " is-new" : ""}`}>
                <div className="inbox-top">
                  <div className="inbox-who">
                    <Avatar name={m.name} size="sm" tone={m.status === "new" ? "amber" : undefined} />
                    <div className="adm-person">
                      <h2 className="inbox-from">{m.name}{m.organization ? <span className="muted"> · {m.organization}</span> : null}</h2>
                      <a href={mailto(m)}>{m.email}</a>
                    </div>
                  </div>
                  <div className="inbox-meta">
                    <span className="badge">{tc(`topic_${m.topic}` as "topic_other")}</span>
                    {m.userId && <span className="badge">{t("signedIn")}</span>}
                    <span className={`status ${m.status === "new" ? "status-pending" : "status-neutral"}`}>{m.status === "new" ? t("statusNew") : t("statusHandled")}</span>
                    <time dateTime={m.createdAt.toISOString()}>{fmt(m.createdAt)}{m.locale === "fr" ? " · FR" : ""}</time>
                  </div>
                </div>
                <p className="inbox-body">{m.message}</p>
                <div className="inbox-actions">
                  <a className="btn btn-secondary btn-sm" href={mailto(m)}><Icon name="mail" size={16} />{t("reply")}</a>
                  {canEdit && <form action={setMessageStatus}>
                    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="f" value={f} />
                    <input type="hidden" name="to" value={m.status === "new" ? "handled" : "new"} />
                    <button className={`btn btn-sm ${m.status === "new" ? "btn-accent" : "btn-ghost"}`}>{m.status === "new" ? <><Icon name="check" size={16} />{t("markHandled")}</> : t("reopen")}</button>
                  </form>}
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
