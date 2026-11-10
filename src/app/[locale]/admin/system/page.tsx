import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { eventTimeZone, dateLocale } from "@/components/EventCard";
import pkg from "../../../../../package.json";
export const dynamic = "force-dynamic";

/**
 * Environment checklist: variable NAMES and whether they are set — values are never read into the page (presence only).
 * need: "required" | "oneOf" (one of the group must be set) | "optional".
 */
const ENV: { group: string; names: string[]; need: "required" | "oneOf" | "optional" }[] = [
  { group: "auth", names: ["AUTH_SECRET"], need: "required" },
  { group: "auth", names: ["AUTH_TRUST_HOST"], need: "optional" },
  { group: "db", names: ["DATABASE_URL", "POSTGRES_PRISMA_URL"], need: "oneOf" },
  { group: "db", names: ["DIRECT_URL", "POSTGRES_URL_NON_POOLING"], need: "optional" },
  { group: "db", names: ["DB_POOL_MAX"], need: "optional" },
  { group: "app", names: ["APP_URL", "APP_ENV"], need: "optional" },
  { group: "payments", names: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ALLOW_MOCK_PAYMENTS"], need: "optional" },
  { group: "ops", names: ["CRON_SECRET", "TRUSTED_PROXY", "TRUSTED_PROXY_HOPS"], need: "optional" },
  { group: "policy", names: ["UNPAID_ORDER_TTL_HOURS", "REJECTED_STUDENT_POLICY", "DELETED_USER_PAID_TICKETS", "DELETED_MEMBERSHIP_REFUND"], need: "optional" },
  { group: "deploy", names: ["VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA"], need: "optional" },
];
const isSet = (k: string) => !!process.env[k]?.trim();

type Migration = { migration_name: string; started_at: Date; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number };
type TableRls = { name: string; rls: boolean };

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; v: T; ms: number } | { ok: false; ms: number }> {
  const t0 = performance.now();
  try {
    const v = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout after 3 s")), 3000))]);
    return { ok: true, v, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    console.error("[admin/system] query failed:", (e as { message?: string })?.message ?? String(e));
    return { ok: false, ms: Math.round(performance.now() - t0) };
  }
}
const safe = async <T,>(fn: () => Promise<T>, fallback: T) => { try { return await fn(); } catch (e) { console.error("[admin/system]", (e as { message?: string })?.message ?? String(e)); return fallback; } };

/** Read-only system overview: database status, migrations, RLS lockdown, record counts, environment checklist, scheduled job. */
export default async function AdminSystem({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale);
  const t = await getTranslations("system");

  const ping = await timed(() => db.$queryRaw<{ v: string }[]>`SELECT current_setting('server_version') AS v`);
  const [migrations, tables, grants, counts, lastCron] = await Promise.all([
    safe(() => db.$queryRaw<Migration[]>`SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at`, [] as Migration[]),
    safe(() => db.$queryRaw<TableRls[]>`SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`, [] as TableRls[]),
    safe(async () => (await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`)[0]?.n ?? 0, -1),
    safe(() => Promise.all([
      db.user.count({ where: { role: { not: "deleted" } } }), db.user.count({ where: { role: "admin" } }), db.user.count({ where: { role: "deleted" } }),
      db.membership.count(), db.membership.count({ where: { status: "active" } }),
      db.event.count(), db.event.count({ where: { published: true } }), db.registration.count(), db.cpeEntry.count(),
      db.contactMessage.count(), db.contentPage.count(), db.setting.count(), db.auditLog.count(), db.loginThrottle.count(),
    ]), null),
    safe(() => db.auditLog.findFirst({ where: { action: "system.cron_expire_unpaid_orders" }, orderBy: { createdAt: "desc" } }), null),
  ]);

  const dl = dateLocale(locale);
  const stamp = (d: Date) => `${new Date(d).toLocaleString(dl, { dateStyle: "medium", timeStyle: "short", timeZone: eventTimeZone })} ${t("et")}`;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const shaShort = sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null; // a commit id is public metadata, not a secret
  const noRls = tables.filter((x) => !x.rls);
  const failedMig = migrations.filter((m) => !m.finished_at || m.rolled_back_at);
  const h2 = { fontSize: "var(--fs-lg)", margin: 0 } as const;
  const yes = (ok: boolean, okLabel: string, badLabel: string, warn = false) => <span className={`badge ${ok ? "badge-green" : warn ? "badge-amber" : "badge-red"}`}>{ok ? okLabel : badLabel}</span>;
  const countRows: [string, number | undefined][] = counts ? [
    ["users", counts[0]], ["admins", counts[1]], ["deletedUsers", counts[2]], ["memberships", counts[3]], ["activeMemberships", counts[4]],
    ["events", counts[5]], ["publishedEvents", counts[6]], ["registrations", counts[7]], ["cpe", counts[8]], ["messages", counts[9]],
    ["contentPages", counts[10]], ["settings", counts[11]], ["auditEntries", counts[12]], ["loginLocks", counts[13]],
  ] : [];
  const fmtN = (n: number) => n.toLocaleString(dl);

  return (
    <div className="app adm"><AdminNav locale={locale} current="/admin/system" />
      <main id="main" className="app-main adm-system">
        <div className="app-head"><div><span className="eyebrow">{t("eyebrow")}</span><h1>{t("title")}</h1><p className="muted adm-lead">{t("lead")}</p></div></div>

        <div className="grid g4 adm-kpis">
          <div className={`kpi${ping.ok ? "" : " kpi-attn"}`}><div className="k">{t("database")}</div><div className="v">{ping.ok ? t("up") : t("down")}</div><div className="d">{ping.ok ? t("latency", { ms: ping.ms }) : t("downHint")}{ping.ok && ping.v[0]?.v ? ` · PostgreSQL ${ping.v[0].v.split(" ")[0]}` : ""}</div></div>
          <div className={`kpi${failedMig.length ? " kpi-attn" : ""}`}><div className="k">{t("migrations")}</div><div className="v">{migrations.length - failedMig.length}</div><div className="d">{failedMig.length ? t("migFailed", { n: failedMig.length }) : t("migAllApplied")}</div></div>
          <div className={`kpi${noRls.length || grants !== 0 ? " kpi-attn" : ""}`}><div className="k">{t("rls")}</div><div className="v">{tables.length - noRls.length}/{tables.length}</div><div className="d">{noRls.length || grants !== 0 ? t("rlsProblem") : t("rlsOk")}</div></div>
          <div className="kpi"><div className="k">{t("version")}</div><div className="v">{pkg.version}</div><div className="d">{shaShort ? <>{t("commit")} <code className="adm-code" title={sha}>{shaShort}</code></> : t("noCommit")} · Node {process.versions.node}</div></div>
        </div>

        <div className="grid g2 adm-dash-grid">
          <section className="card" aria-labelledby="sys-counts">
            <h2 id="sys-counts" style={h2}>{t("records")}</h2>
            {counts ? <div className="table-wrap" tabIndex={0} role="region" aria-label={t("records")}><table className="adm-sys-table">
              <thead><tr><th scope="col">{t("table")}</th><th scope="col" className="num">{t("count")}</th></tr></thead>
              <tbody>{countRows.map(([k, n]) => <tr key={k}><th scope="row">{t(`n_${k}`)}</th><td className="num">{fmtN(n ?? 0)}</td></tr>)}</tbody>
            </table></div> : <div className="adm-empty"><p>{t("unavailable")}</p></div>}
          </section>

          <section className="card" aria-labelledby="sys-cron">
            <h2 id="sys-cron" style={h2}>{t("jobs")}</h2>
            <div className="adm-person">
              <b>{t("jobExpire")}</b>
              <span className="small muted">{t("jobExpireHint")}</span>
              <span className="small"><code className="adm-code">GET /api/cron/expire-unpaid-orders</code> · {t("schedule")}</span>
            </div>
            <ul className="adm-log">
              <li><span>{t("cronSecret")}</span>{yes(isSet("CRON_SECRET"), t("configured"), t("notConfigured"), true)}</li>
              <li><span>{t("lastRun")}</span><span className="small">{lastCron ? <time dateTime={lastCron.createdAt.toISOString()}>{stamp(lastCron.createdAt)}</time> : <span className="muted">{t("never")}</span>}{lastCron?.target?.startsWith("expired:") ? ` · ${t("expiredN", { n: Number(lastCron.target.slice(8)) || 0 })}` : ""}</span></li>
            </ul>
            <p className="small muted" style={{ margin: 0 }}>{t("cliHint")} <code className="adm-code">npm run expire-unpaid-orders</code></p>
          </section>
        </div>

        <section className="card adm-section" aria-labelledby="sys-mig">
          <h2 id="sys-mig" style={h2}>{t("migrations")}</h2>
          {migrations.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label={t("migrations")}><table className="adm-stack adm-stack-2 adm-sys-table">
            <thead><tr><th scope="col">{t("migName")}</th><th scope="col">{t("status")}</th><th scope="col">{t("appliedAt")}</th></tr></thead>
            <tbody>{migrations.map((m) => <tr key={m.migration_name}>
              <td data-label={t("migName")}><code className="adm-code">{m.migration_name}</code></td>
              <td data-label={t("status")}>{m.rolled_back_at ? yes(false, "", t("rolledBack")) : m.finished_at ? yes(true, t("applied"), "") : yes(false, "", t("failed"))}</td>
              <td className="nowrap" data-label={t("appliedAt")}>{m.finished_at ? stamp(m.finished_at) : "—"}</td>
            </tr>)}</tbody>
          </table></div> : <div className="adm-empty"><p>{t("unavailable")}</p></div>}
        </section>

        <section className="card adm-section" aria-labelledby="sys-rls">
          <div className="adm-card-head"><h2 id="sys-rls" style={h2}>{t("rlsTitle")}</h2>{grants > 0 ? <span className="badge badge-red">{t("grantsFound", { n: grants })}</span> : grants === 0 ? <span className="badge badge-green">{t("noGrants")}</span> : null}</div>
          <p className="small muted" style={{ margin: 0 }}>{t("rlsHint")}</p>
          {tables.length ? <ul className="adm-sys-chips">{tables.map((x) => <li key={x.name}><code className="adm-code">{x.name}</code> {yes(x.rls, t("rlsOn"), t("rlsOff"))}</li>)}</ul>
            : <div className="adm-empty"><p>{t("unavailable")}</p></div>}
        </section>

        <section className="card adm-section" aria-labelledby="sys-env">
          <h2 id="sys-env" style={h2}>{t("env")}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t("envHint")}</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("env")}><table className="adm-stack adm-stack-2 adm-sys-table">
            <thead><tr><th scope="col">{t("envName")}</th><th scope="col">{t("envState")}</th><th scope="col">{t("envNeed")}</th></tr></thead>
            <tbody>{ENV.flatMap((g) => {
              const groupOk = g.names.some(isSet);
              return g.names.map((k) => <tr key={k}>
                <td data-label={t("envName")}><div className="adm-person"><code className="adm-code">{k}</code><span className="small muted">{t(`env_${k}`)}</span></div></td>
                <td data-label={t("envState")}>{isSet(k) ? yes(true, t("set"), "") : g.need === "required" || (g.need === "oneOf" && !groupOk) ? yes(false, "", t("missing")) : <span className="badge">{t("notSet")}</span>}</td>
                <td data-label={t("envNeed")}><span className="small">{g.need === "required" ? t("required") : g.need === "oneOf" ? t("oneOf", { names: g.names.join(" / ") }) : t("optional")}</span></td>
              </tr>);
            })}</tbody>
          </table></div>
        </section>
      </main>
    </div>
  );
}
