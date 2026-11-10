import { evLabel, fmt, eventCurrency } from "@/config/site";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/session";
import { idParam } from "@/lib/validation";
import { eventView, eventTimeZone, dateLocale, fmtDuration, fmtCpe, fmtTentativeMonth, eventLocation, eventTypeBadgeClass } from "@/components/EventCard";
import { register } from "./actions";
export const dynamic = "force-dynamic";

export default async function EventDetail({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ registered?: string; error?: string }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const e = idParam(slug, 200) ? await db.event.findUnique({ where: { slug } }) : null; // control characters / over-long → not found
  const s = await auth(); const signedIn = !!s?.user?.id;
  if (!e || ((!e.published || e.cancelledAt) && s?.user?.role !== "admin")) notFound(); // drafts and cancelled events are visible to staff only
  const t = await getTranslations("events"); const tm = await getTranslations("membership");
  const isMember = signedIn ? !!(await activeMembership(s!.user!.id!)) : false;
  const reg = signedIn ? await db.registration.findUnique({ where: { userId_eventId: { userId: s!.user!.id!, eventId: e.id } } }) : null;
  const sp = await searchParams; const confirmed = reg?.status === "confirmed"; const pendingPay = reg?.status === "pending_payment";
  const v = eventView(e, locale);
  const myPrice = isMember ? e.memberPriceCents : e.publicPriceCents;
  const dl = dateLocale(locale);
  const date = v.start.toLocaleDateString(dl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: eventTimeZone });
  const tm2 = (d: Date) => d.toLocaleTimeString(dl, { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone });
  const time = v.planned ? t("tbc") : `${tm2(v.start)} – ${tm2(v.end)} ${t("tz")}`;
  // Unconfirmed events never show a specific day — only the tentative month.
  const tentative = t("tentatively", { month: fmtTentativeMonth(v.start, locale) });
  const dateShown = v.planned ? `${t("tbc")} (${tentative})` : date;
  const where = eventLocation(e, t("venueTbc"));
  const price = (c: number | null) => (c === null ? t("tbc") : c === 0 ? t("free") : fmt(c, eventCurrency, locale));
  const paidPrices = (e.memberPriceCents ?? 0) > 0 || (e.publicPriceCents ?? 0) > 0;
  const open = !v.planned && !v.past;
  const statusLabel = v.status ? t(v.status) : null;

  const rows: [string, string][] = [
    [t("date"), dateShown],
    [t("time"), time],
    [t("format"), evLabel(e.format, locale)],
    ...(where ? [[t("location"), where] as [string, string]] : []),
    [t("duration"), fmtDuration(e.durationMin, locale)],
    [t("cpe"), `${v.planned ? `${t("upTo")} ` : ""}${fmtCpe(e.cpe, locale)}`],
  ];

  return (
    <main id="main" className="event-detail">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><ol><li><a href={`/${locale}`}>{tm("home")}</a></li><li><a href={`/${locale}/events`}>{t("eyebrow")}</a></li><li aria-current="page" title={v.title}>{v.title}</li></ol></nav>
        <div className="tags ev-hero-tags">
          <span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span>
          {statusLabel && <span className="badge ev-status">{statusLabel}</span>}
          {v.past && <span className="badge">{t("past")}</span>}
          {open && e.memberPriceCents === 0 && <span className="badge badge-green">{t("membersFree")}</span>}
        </div>
        <h1>{v.title}</h1>
        <p className="lead">{locale === "fr" && e.summaryFr ? e.summaryFr : e.summary}</p>
        <p className="ev-when ev-meta">{(v.planned ? [`${t("dateTbc")} (${tentative})`, evLabel(e.format, locale)] : [date, time, evLabel(e.format, locale)]).map((x, i) => <Fragment key={i}>{i > 0 && " "}<span>{x}</span></Fragment>)}</p>
      </div></section>
      <section className="section"><div className="container layout-aside">
        <div>
          {v.planned && <div className="alert alert-info" role="note" style={{ marginBottom: 24 }}><div><b>{t("plannedTitle")}</b>{t("plannedBody")}</div></div>}
          <h2 className="ev-h2">{t("details")}</h2>
          <dl className="ev-dl">{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
          <p className="small muted" style={{ marginTop: 16 }}>{t("note")} {t("tzNote")}</p>
        </div>
        <aside><div className="card sticky-side ev-reg">
          <h2 className="ev-h3">{t("register")}</h2>
          <h3 className="label">{t("pricing")}</h3>
          {v.planned ? (
            <p className="small muted" style={{ margin: 0 }}>{t("pricesTba")}</p>
          ) : (
            <ul className="ev-prices">
              <li className={signedIn && isMember ? "is-mine" : ""}><span>{t("member")}{signedIn && isMember && <span className="badge badge-green">{t("yourPrice")}</span>}</span><b>{price(e.memberPriceCents)}</b></li>
              <li className={signedIn && !isMember ? "is-mine" : ""}><span>{t("nonMember")}{signedIn && !isMember && <span className="badge badge-green">{t("yourPrice")}</span>}</span><b>{price(e.publicPriceCents)}</b></li>
            </ul>
          )}

          {confirmed ? (
            <div className="alert alert-success" role="status"><div><b>{t("registered")}</b>{t("registeredBody")} <a href={`/${locale}/my/events`}>{t("myEvents")} →</a></div></div>
          ) : v.past ? (
            <div className="alert alert-info" role="note"><div>{t("pastBody")}</div></div>
          ) : v.planned ? (
            <div className="alert alert-info" role="note"><div>{t("regOpensLater")}</div></div>
          ) : !signedIn ? (
            <>
              <a className="btn btn-accent btn-block" href={`/${locale}/login`}>{t("signInToRegister")}</a>
              <p className="small muted ev-hint">{t("signInHint")} {t("notMember")} <a href={`/${locale}/join`}>{t("joinLink")} →</a></p>
            </>
          ) : myPrice === null ? (
            <div className="alert alert-info" role="note"><div>{t("tbcBlocked")} <a href={`/${locale}/membership`}>{t("joinLink")} →</a></div></div>
          ) : (
            <>
              {pendingPay && <div className="alert alert-warning" role="status"><div>{t("pending")}</div></div>}
              {sp.error === "tbc" && <div className="alert alert-danger" role="alert"><div>{t("tbcBlocked")}</div></div>}
              <form action={register}><input type="hidden" name="slug" value={e.slug} /><input type="hidden" name="locale" value={locale} />
                <button className="btn btn-accent btn-block">{pendingPay ? t("completePayment") : myPrice ? `${t("payAndRegister")} · ${fmt(myPrice, eventCurrency, locale)}` : t("registerFree")}</button>
              </form>
              {!isMember && myPrice > e.memberPriceCents && <p className="small muted ev-hint">{t("memberHint")} <a href={`/${locale}/join`}>{t("joinLink")} →</a></p>}
            </>
          )}
          {open && paidPrices && <p className="small muted ev-foot">{t("cadOnly")}</p>}
        </div></aside>
      </div></section>
    </main>
  );
}
