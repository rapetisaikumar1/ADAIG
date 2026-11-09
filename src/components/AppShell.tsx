import { getTranslations } from "next-intl/server";
import { signOut } from "@/auth";

export async function MemberNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("member"); const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  const a = (p: string, label: string) => <a href={L(p)} aria-current={current === p ? "page" : undefined}>{label}</a>;
  return (
    <nav className="sidenav" aria-label="Member navigation">
      <h2>{t("overview")}</h2>{a("/my/dashboard", t("dashboard"))}{a("/my/profile", t("profile"))}{a("/my/billing", t("billing"))}
      <h2>{t("grow")}</h2>{a("/my/credentials", t("credentials"))}{a("/my/learning", t("learning"))}{a("/my/events", t("events"))}
      <h2>{t("connect")}</h2>{a("/my/community", t("community"))}{a("/my/directory", t("directory"))}{a("/resources", t("library"))}
      <SignOutButton label={tc("signOut")} locale={locale} />
    </nav>
  );
}

export async function AdminNav({ locale, current }: { locale: string; current: string }) {
  const t = await getTranslations("adminNav"); const tc = await getTranslations("chrome");
  const L = (p: string) => `/${locale}${p}`;
  const a = (p: string, label: string) => <a href={L(p)} aria-current={current === p ? "page" : undefined}>{label}</a>;
  return (
    <nav className="sidenav" aria-label="Admin navigation">
      <h2>{t("staff")}</h2>{a("/admin/dashboard", t("overview"))}{a("/admin/members", t("members"))}{a("/admin/events", t("events"))}{a("/admin/content", t("content"))}{a("/admin/credentialing", t("credentialing"))}
      <h2>{t("delegated")}</h2>{a("/admin/corporate", t("corporate"))}{a("/admin/chapter", t("chapter"))}
      <h2>{t("switch")}</h2>{a("/my/dashboard", t("memberView"))}
      <SignOutButton label={tc("signOut")} locale={locale} />
    </nav>
  );
}

function SignOutButton({ label, locale }: { label: string; locale: string }) {
  return (
    <form action={async () => { "use server"; await signOut({ redirectTo: `/${locale}` }); }} style={{ marginTop: 16 }}>
      <button className="btn btn-ghost btn-sm">{label}</button>
    </form>
  );
}
