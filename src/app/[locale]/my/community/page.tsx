import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, activeMembership } from "@/lib/session";
import { MemberNav } from "@/components/AppShell";
import type { Locale } from "@/config/site";
import { memberMetadata } from "../_shared/meta";
import { PageHead, noArrow } from "../_shared/ui";
import { Status } from "@/components/ui/Facet";
import { Icon, type IconName } from "@/components/ui/Icon";
export const dynamic = "force-dynamic";
export const generateMetadata = memberMetadata("community");

/** Member community hub. Online discussions are not built yet, so this page says so and points to what exists today. */
export default async function MyCommunity({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const u = await requireUser(locale); const t = await getTranslations("member.communityPage");
  // Same rule as /my/directory (round-7 S4): an active membership; Admin Portal accounts (role admin) never browse it.
  const canBrowse = u.role !== "admin" && !!(await activeMembership(u.id));
  const L = (p: string) => `/${locale}${p}`;
  const items: { key: string; status?: "available" | "planned" | "proposed"; icon: IconName; href?: string }[] = [
    { key: "events", status: "available", icon: "calendar", href: "/events" },
    canBrowse ? { key: "directory", status: "available", icon: "book", href: "/my/directory" } : { key: "directoryGuest", status: "available", icon: "book", href: "/membership" },
    { key: "discussions", status: "planned", icon: "inbox" },
    { key: "groups", status: "planned", icon: "users", href: "/community" },
    { key: "working", status: "proposed", icon: "compass", href: "/contact?topic=community" },
    { key: "conduct", icon: "scale", href: "/governance#ethics" }, // no status chip
  ];
  // The one status component: live features are "available"; planned and proposed items share the in-development tone.
  const tone = { available: "available", planned: "dev", proposed: "dev" } as const;
  return (
    <div className="app"><MemberNav locale={locale} current="/my/community" />
      <main id="main" tabIndex={-1} className="app-main mbr mbr-community">
        <PageHead title={t("title")} lead={t("lead")} />
        <ul className="grid g3 mbr-com">
          {items.map((i) => (
            <li key={i.key} className={`card mbr-com-card${i.status === "available" ? " is-live" : ""}`}>
              <div className="mbr-com-top"><span className="icon-tile" aria-hidden="true"><Icon name={i.icon} /></span>{i.status && <Status tone={tone[i.status]}>{t(i.status)}</Status>}</div>
              <h2 id={`h-${i.key}`}>{t(`${i.key}Title`)}</h2>
              <p>{t(`${i.key}Body`)}</p>
              {/* The link's own text names the destination; its hit area covers the whole card (.mbr-stretch). */}
              {i.href && <p className="card-foot"><a className="link-arrow mbr-stretch" href={L(i.href)}>{noArrow(t(`${i.key}Link`))}</a></p>}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
