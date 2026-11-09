import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import type { Locale } from "@/config/site";
export const dynamic = "force-dynamic";

/** Member community hub. Online discussions are not built yet, so this page says so and points to what exists today. */
export default async function MyCommunity({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  await requireUser(locale); const t = await getTranslations("member.communityPage");
  const L = (p: string) => `/${locale}${p}`;
  const items: { key: string; status: "available" | "planned" | "proposed" | "draft"; href?: string }[] = [
    { key: "events", status: "available", href: "/events" },
    { key: "directory", status: "available", href: "/my/directory" },
    { key: "discussions", status: "planned" },
    { key: "groups", status: "planned", href: "/community" },
    { key: "working", status: "proposed", href: "/community" },
    { key: "conduct", status: "draft", href: "/governance#ethics" },
  ];
  const badge = { available: "badge-green", planned: "badge-amber", proposed: "badge-amber", draft: "badge-amber" } as const;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/community" />
      <main id="main" className="app-main mbr">
        <div className="app-head"><h1>{t("title")}</h1></div>
        <p className="lead mbr-lead">{t("lead")}</p>
        <div className="grid g3 mbr-cards">
          {items.map((i) => (
            <section key={i.key} className="card" aria-labelledby={`h-${i.key}`}>
              <div className="tags"><span className={`badge ${badge[i.status]}`}>{t(i.status)}</span></div>
              <h2 id={`h-${i.key}`} style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{t(`${i.key}Title`)}</h2>
              <p>{t(`${i.key}Body`)}</p>
              {i.href && <p className="small mbr-foot"><a href={L(i.href)}>{t(`${i.key}Link`)}</a></p>}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
