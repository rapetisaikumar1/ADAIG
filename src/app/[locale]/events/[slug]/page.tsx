import { evLabel } from "@/config/site";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/session";
import { fmt, eventCurrency } from "@/config/site";
import { register } from "./actions";
export const dynamic = "force-dynamic";

export default async function EventDetail({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ registered?: string; error?: string }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const e = await db.event.findUnique({ where: { slug } }); if (!e) notFound();
  const t = await getTranslations("events"); const tm = await getTranslations("membership");
  const s = await auth(); const isMember = s?.user?.id ? !!(await activeMembership(s.user.id)) : false;
  const reg = s?.user?.id ? await db.registration.findUnique({ where: { userId_eventId: { userId: s.user.id, eventId: e.id } } }) : null;
  const sp = await searchParams; const confirmed = reg?.status === "confirmed"; const pendingPay = reg?.status === "pending_payment";
  const myPrice = isMember ? e.memberPriceCents : e.publicPriceCents;
  const d = new Date(e.startsAt); const end = new Date(d.getTime() + e.durationMin * 60000);
  const dl = locale === "fr" ? "fr-FR" : "en-US";
  const price = (c: number | null) => (c === null ? t("tbc") : c === 0 ? t("free") : fmt(c, eventCurrency, locale));
  const title = locale === "fr" && e.titleFr ? e.titleFr : e.title;
  return (
    <main id="main">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{tm("home")}</a></li><li><a href={`/${locale}/events`}>{t("eyebrow")}</a></li><li aria-current="page">{title}</li></ol></nav>
        <span className="eyebrow">{evLabel(e.type, locale)} · {e.cpe} CPE</span><h1>{title}</h1><p className="lead">{e.summary}</p>
        <div className="tags" style={{ marginTop: 12 }}><span className="badge badge-teal">{evLabel(e.format, locale)}</span>{e.memberPriceCents === 0 && <span className="badge badge-green">{t("membersFree")}</span>}</div>
      </div></section>
      <section className="section"><div className="container layout-aside">
        <div><h2>{t("about")}</h2><p>{e.summary}</p><p className="muted small">{e.durationMin} {t("min")} · {e.cpe} CPE{e.location ? ` · ${e.location}` : ""}</p></div>
        <aside><div className="card sticky-side"><h3>{t("register")}</h3>
          <p><b>{d.toLocaleDateString(dl, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</b><br />{d.toLocaleTimeString(dl, { hour: "2-digit", minute: "2-digit" })}–{end.toLocaleTimeString(dl, { hour: "2-digit", minute: "2-digit" })} · {evLabel(e.format, locale)}</p>
          <fieldset style={{ border: 0, padding: 0 }}><legend className="label">{t("ticket")}</legend>
            <label className="check"><input type="radio" name="t" checked={isMember} readOnly disabled={!isMember} /> {t("member")} — {price(e.memberPriceCents)}</label>
            <label className="check"><input type="radio" name="t" checked={!isMember} readOnly disabled={isMember} /> {t("nonMember")} — {price(e.publicPriceCents)}</label>
          </fieldset>
          {confirmed ? (
            <div className="alert alert-success" role="status" style={{ marginTop: 12 }}><div><b>{t("registered")}</b>{t("registeredBody")}</div></div>
          ) : s?.user && myPrice === null ? (
            <div className="alert alert-info" role="note" style={{ marginTop: 12 }}><div>{t("tbcBlocked")} <a href={`/${locale}/membership`}>{t("member")} →</a></div></div>
          ) : s?.user ? (
            <>
              {pendingPay && <div className="alert alert-warning" role="status" style={{ marginTop: 12 }}><div>{t("pending")}</div></div>}
              {sp.error === "tbc" && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><div>{t("tbcBlocked")}</div></div>}
              <form action={register}><input type="hidden" name="slug" value={e.slug} /><input type="hidden" name="locale" value={locale} /><button className="btn btn-accent btn-block" style={{ marginTop: 12 }}>{pendingPay ? t("completePayment") : myPrice ? `${t("payAndRegister")} · ${fmt(myPrice, eventCurrency, locale)}` : t("register")}</button></form>
            </>
          ) : (
            <a className="btn btn-accent btn-block" style={{ marginTop: 12 }} href={`/${locale}/login`}>{t("signInToRegister")}</a>
          )}
          <p className="small muted">{t("note")} {t("cadOnly")}</p>
        </div></aside>
      </div></section>
    </main>
  );
}
