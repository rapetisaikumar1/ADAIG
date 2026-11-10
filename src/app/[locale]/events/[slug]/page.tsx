import type { Metadata } from "next";
import { evLabel, fmt, eventCurrency } from "@/config/site";
import { Fragment, cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/session";
import { idParam } from "@/lib/validation";
import { eventView, eventTimeZone, dateLocale, fmtDuration, fmtCpe, fmtTentativeMonth, eventLocation, eventTypeBadgeClass } from "@/components/EventCard";
import { EventAccessInfo, eventAccessInfo } from "@/components/EventAccessInfo";
import { register } from "./actions";
export const dynamic = "force-dynamic";

/** One event lookup per request, shared by generateMetadata and the page (control characters / over-long slugs → not found). */
const findEvent = cache((slug: string) => (idParam(slug, 200) ? db.event.findUnique({ where: { slug } }) : Promise.resolve(null)));

/** <title> = the event's own (localized) title — the [locale] layout template adds " · ADAIG" (R1-11). Events the visitor can't see
 *  (unknown slug, draft or cancelled for non-staff) get the same "Page not found" title as the 404 page they render (R2-4). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const e = await findEvent(slug);
  const visible = !!e && ((e.published && !e.cancelledAt) || (await auth())?.user?.role === "admin");
  if (!e || !visible) return { title: (await getTranslations({ locale, namespace: "meta" }))("notFound") };
  const summary = locale === "fr" && e.summaryFr ? e.summaryFr : e.summary;
  return { title: eventView(e, locale).title, ...(summary ? { description: summary } : {}) };
}

export default async function EventDetail({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ registered?: string; error?: string }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const e = await findEvent(slug);
  const s = await auth(); const signedIn = !!s?.user?.id;
  if (!e || ((!e.published || e.cancelledAt) && s?.user?.role !== "admin")) notFound(); // drafts and cancelled events are visible to staff only
  const t = await getTranslations("events"); const tm = await getTranslations("membership"); const tc = await getTranslations("chrome");
  const isMember = signedIn ? !!(await activeMembership(s!.user!.id!)) : false;
  const reg = signedIn ? await db.registration.findUnique({ where: { userId_eventId: { userId: s!.user!.id!, eventId: e.id } } }) : null;
  const sp = await searchParams; const confirmed = reg?.status === "confirmed"; const pendingPay = reg?.status === "pending_payment";
  const v = eventView(e, locale);
  const myPrice = isMember ? e.memberPriceCents : e.publicPriceCents;
  const dl = dateLocale(locale);
  const date = v.start.toLocaleDateString(dl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: eventTimeZone });
  const tm2 = (d: Date) => d.toLocaleTimeString(dl, { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone });
  const time = `${tm2(v.start)} – ${tm2(v.end)} ${t("tz")}`;
  // Unconfirmed events never show a specific day or time — only the tentative month.
  const month = fmtTentativeMonth(v.start, locale);
  const dateShown = v.planned ? `${t("tbc")} (${t("tentatively", { month })})` : date;
  const where = eventLocation(e, t("venueTbc"));
  const price = (c: number | null) => (c === null ? t("tbc") : c === 0 ? t("free") : fmt(c, eventCurrency, locale));
  const open = !v.planned && !v.past;
  const statusLabel = v.status ? t(v.status) : null;
  const accessInfo = confirmed ? eventAccessInfo(e, locale) : null; // joining details: confirmed registrants only
  // Return here after signing in (validated again by the login action; same-site paths only).
  const loginHref = `/${locale}/login?next=${encodeURIComponent(`/${locale}/events/${e.slug}`)}`;

  // Unconfirmed events: no time row (the date row already says "to be confirmed"), a tentative duration and no CPE figure,
  // so nothing unconfirmed is stated as a fact.
  const rows: [string, string][] = [
    [t("date"), dateShown],
    ...(v.planned ? [] : [[t("time"), time] as [string, string]]),
    [t("format"), evLabel(e.format, locale)],
    ...(where ? [[t("location"), where] as [string, string]] : []),
    [t("duration"), v.planned ? `${fmtDuration(e.durationMin, locale)} (${t("tentativeShort")})` : fmtDuration(e.durationMin, locale)],
    [t("cpe"), v.planned ? t("tbc") : fmtCpe(e.cpe, locale)],
  ];

  return (
    <main id="main" className="event-detail">
      <section className="page-hero"><div className="container">
        <nav className="crumbs" aria-label={tc("breadcrumbAria")}><ol><li><a href={`/${locale}`}>{tm("home")}</a></li><li><a href={`/${locale}/events`}>{t("eyebrow")}</a></li><li aria-current="page" title={v.title}>{v.title}</li></ol></nav>
        <div className="tags ev-hero-tags">
          <span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span>
          {statusLabel && <span className="badge ev-status">{statusLabel}</span>}
          {v.past && <span className="badge">{t("past")}</span>}
          {open && e.memberPriceCents === 0 && <span className="badge badge-green">{t("membersFree")}</span>}
        </div>
        <h1>{v.title}</h1>
        <p className="lead">{locale === "fr" && e.summaryFr ? e.summaryFr : e.summary}</p>
        <p className="ev-when ev-meta">{(v.planned ? [t("tentativeCap", { month }), evLabel(e.format, locale)] : [date, time, evLabel(e.format, locale)]).map((x, i) => <Fragment key={i}>{i > 0 && " "}<span>{x}</span></Fragment>)}</p>
        {/* Small screens: the registration card sits below the details, so link to it from the hero. */}
        {(open || confirmed) && <a className="btn btn-outline-light ev-jump" href="#register">{confirmed ? t("yourRegistration") : t("register")}</a>}
      </div></section>
      <section className="section"><div className="container layout-aside">
        <div>
          {v.planned && <div className="alert alert-info" role="note" style={{ marginBottom: 24 }}><div><b>{t("plannedTitle")}</b>{t("plannedBody")}</div></div>}
          <h2 className="ev-h2">{t("details")}</h2>
          <dl className="ev-dl">{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
          <p className="small muted" style={{ marginTop: 16 }}>{t("note")}{!v.planned && <> {t("tzNote")}</>}</p>
        </div>
        <aside><div className="card sticky-side ev-reg" id="register">
          <h2 className="ev-h3">{t("register")}</h2>
          {!v.planned && <>
            <h3 className="label">{t("pricing")}</h3>
            <ul className="ev-prices">
              <li className={signedIn && isMember ? "is-mine" : ""}><span>{t("member")}{signedIn && isMember && <span className="badge badge-green">{t("yourPrice")}</span>}</span><b>{price(e.memberPriceCents)}</b></li>
              <li className={signedIn && !isMember ? "is-mine" : ""}><span>{t("nonMember")}{signedIn && !isMember && <span className="badge badge-green">{t("yourPrice")}</span>}</span><b>{price(e.publicPriceCents)}</b></li>
            </ul>
          </>}

          {confirmed ? (
            <>
              <div className="alert alert-success" role="status"><div><b>{t("registered")}</b>{t("registeredBody")} <a href={`/${locale}/my/events`}>{t("myEvents")} →</a></div></div>
              {accessInfo ? <EventAccessInfo text={accessInfo} title={t("accessTitle")} note={t("accessPrivate")} />
                : !v.past && <p className="small muted ev-hint">{t("accessPending")}</p>}
            </>
          ) : v.past ? (
            <div className="alert alert-info" role="note"><div>{t("pastBody")}</div></div>
          ) : v.planned ? (
            <div className="alert alert-info" role="note"><div>{t("regOpensLater")}</div></div>
          ) : !signedIn ? (
            <>
              <a className="btn btn-primary btn-block" href={loginHref}>{t("signInToRegister")}</a>
              {e.publicPriceCents === null
                ? <p className="small muted ev-hint">{t("membersOnlyHint")} {t("notMember")} <a href={`/${locale}/join`}>{t("joinLink")} →</a></p>
                : <p className="small muted ev-hint">{t("signInHint")} {t("notMember")} <a href={`/${locale}/join`}>{t("joinLink")} →</a></p>}
            </>
          ) : myPrice === null ? (
            <div className="alert alert-info" role="note"><div>{t("tbcBlocked")} <a href={`/${locale}/join`}>{t("joinLink")} →</a></div></div>
          ) : (
            <>
              {pendingPay && <div className="alert alert-warning" role="status"><div>{t("pending")}</div></div>}
              {sp.error === "pay" && <div className="alert alert-danger" role="alert"><div>{t("payError")}</div></div>}
              {sp.error === "tbc" && <div className="alert alert-danger" role="alert"><div>{t("tbcBlocked")}</div></div>}
              <form action={register}><input type="hidden" name="slug" value={e.slug} /><input type="hidden" name="locale" value={locale} />
                <button className="btn btn-accent btn-block">{pendingPay ? t("completePayment") : myPrice ? `${t("payAndRegister")} · ${fmt(myPrice, eventCurrency, locale)}` : t("registerFree")}</button>
              </form>
              {!isMember && myPrice > e.memberPriceCents && <p className="small muted ev-hint">{t("memberHint")} <a href={`/${locale}/join`}>{t("joinLink")} →</a></p>}
            </>
          )}
        </div></aside>
      </div></section>
    </main>
  );
}
