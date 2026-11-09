import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AppShell";
import { getTier, fmt2, currencies, knownCurrencies, type Currency, type Locale } from "@/config/site";
export const dynamic = "force-dynamic";

export default async function AdminDash({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireAdmin(locale); const t = await getTranslations("admin");
  const [activeRows, guests, regs, recent, logs, paid] = await Promise.all([
    db.membership.findMany({ where: { status: "active", user: { role: { not: "deleted" } } }, select: { userId: true, tierId: true } }),
    db.user.count({ where: { role: "guest" } }), db.registration.count({ where: { status: "confirmed" } }),
    db.membership.findMany({ where: { status: "active" }, include: { user: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.membership.findMany({ where: { paymentRef: { not: null } }, select: { status: true, refundStatus: true, currency: true, amountCents: true } }),
  ]);
  // BUG-040: count distinct PEOPLE (a user with two active rows counts once), overall and per tier.
  const active = new Set(activeRows.map((r) => r.userId)).size;
  const tierPeople = new Map<string, Set<string>>();
  for (const r of activeRows) { if (!tierPeople.has(r.tierId)) tierPeople.set(r.tierId, new Set()); tierPeople.get(r.tierId)!.add(r.userId); }
  const byTier = [...tierPeople].map(([tierId, set]) => ({ tierId, n: set.size }));
  // Dues collected (paid memberships, excl. tax) split by what happened to them, per currency.
  type B = "duesActive" | "duesPendingVer" | "duesCancelled" | "duesRefundDue" | "duesRefunded";
  const bucket = (m: (typeof paid)[number]): B => m.refundStatus === "refunded" ? "duesRefunded" : m.refundStatus === "refund_due" ? "duesRefundDue" : m.status === "active" ? "duesActive" : m.status === "pending_verification" ? "duesPendingVer" : "duesCancelled";
  const buckets: B[] = ["duesActive", "duesPendingVer", "duesCancelled", "duesRefundDue", "duesRefunded"];
  const sum = (f: (m: (typeof paid)[number]) => boolean, c: string) => paid.filter((m) => m.currency === c && f(m)).reduce((x, m) => x + m.amountCents, 0);
  // historic payments keep their own currency (e.g. CAD before the USD-only decision): show every currency that has data
  const cols = knownCurrencies.filter((c) => currencies.includes(c) || paid.some((m) => m.currency === c)) as Currency[];
  const rev = cols.map((c) => [c, sum((m) => bucket(m) === "duesActive", c)] as const);
  return (
    <div className="app"><AdminNav locale={locale} current="/admin/dashboard" />
      <main id="main" className="app-main">
        <div className="app-head"><h1>{t("title")}</h1></div>
        <div className="grid g4" style={{ marginBottom: 24 }}>
          <div className="kpi"><div className="k">{t("members")}</div><div className="v">{active}</div><div className="small muted">{t("people")}</div><div className="d">{byTier.map((b) => `${getTier(b.tierId)?.name[locale]}: ${b.n}`).join(" · ")}</div></div>
          <div className="kpi"><div className="k">{t("guests")}</div><div className="v">{guests}</div><div className="d">{t("funnel")}</div></div>
          <div className="kpi"><div className="k">{t("revenue")}</div><div className="v" style={{ fontSize: "1.2rem" }}>{rev.map(([c, v]) => fmt2(v, c, locale)).join(" / ")}</div><div className="d">{t("exclTax")}</div></div>
          <div className="kpi"><div className="k">{t("regs")}</div><div className="v">{regs}</div><div className="d">{t("allEvents")}</div></div>
        </div>
        <section className="card" style={{ marginBottom: 24 }}><h2 style={{ fontSize: "var(--fs-lg)" }}>{t("duesTitle")}</h2><div className="table-wrap" tabIndex={0} role="region" aria-label={t("duesTitle")}><table><thead><tr><th scope="col">{t("status")}</th>{cols.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead><tbody>
          {buckets.map((k) => <tr key={k}><th scope="row">{t(k)}</th>{cols.map((c) => <td key={c}>{fmt2(sum((m) => bucket(m) === k, c), c, locale)}</td>)}</tr>)}
          <tr><th scope="row">{t("duesNet")}</th>{cols.map((c) => <td key={c}><strong>{fmt2(sum((m) => bucket(m) !== "duesRefunded", c), c, locale)}</strong></td>)}</tr>
        </tbody></table></div></section>
        <div className="grid g2">
          <section className="card"><h2 style={{ fontSize: "var(--fs-lg)" }}>{t("recent")}</h2><div className="table-wrap" tabIndex={0} role="region" aria-label={t("tableLabel")}><table><thead><tr><th scope="col">{t("name")}</th><th scope="col">{t("tier")}</th><th scope="col">{t("joined")}</th></tr></thead><tbody>
            {recent.map((m) => <tr key={m.id}><td>{m.user.name}</td><td>{getTier(m.tierId)?.name[locale]}</td><td>{m.startsAt?.toISOString().slice(0, 10)}</td></tr>)}
          </tbody></table></div></section>
          <section className="card"><h2 style={{ fontSize: "var(--fs-lg)" }}>{t("audit")}</h2><ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{logs.map((l) => <li key={l.id}><code>{l.action}</code> · {l.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</li>)}</ul></section>
        </div>
      </main>
    </div>
  );
}
