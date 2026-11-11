import type { Metadata } from "next";
import { evLabel, fmt, eventCurrency } from "@/config/site";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/session";
import { canPerm } from "@/lib/permissions";
import { idParam } from "@/lib/validation";
import { eventView, eventTimeZone, dateLocale, fmtDuration, fmtCpe, fmtTentativeMonth, eventLocation, eventTypeBadgeClass, locationRepeatsFormat } from "@/components/EventCard";
import { EventAccessInfo, eventAccessInfo } from "@/components/EventAccessInfo";
import { register } from "./actions";
import { Icon } from "@/components/ui/Icon";
import { FocusOnLoad } from "@/components/ui/FocusOnLoad";
export const dynamic = "force-dynamic";

/** One event lookup per request, shared by generateMetadata and the page (control characters / over-long slugs → not found). */
const findEvent = cache((slug: string) => (idParam(slug, 200) ? db.event.findUnique({ where: { slug } }) : Promise.resolve(null)));

/** <title> = the event's own (localized) title — the [locale] layout template adds " · ADAIG" (R1-11). Events the visitor can't see
 *  (unknown slug, draft or cancelled for anyone without events.view) get the same "Page not found" title as the 404 page they render (R2-4). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const e = await findEvent(slug);
  const visible = !!e && ((e.published && !e.cancelledAt) || canPerm((await auth())?.user?.permissions, "events", "view"));
  if (!e || !visible) return { title: (await getTranslations({ locale, namespace: "meta" }))("notFound") };
  const summary = locale === "fr" && e.summaryFr ? e.summaryFr : e.summary;
  return { title: eventView(e, locale).title, ...(summary ? { description: summary } : {}) };
}

export default async function EventDetail({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ registered?: string; error?: string }> }) {
  const { locale, slug } = await params; setRequestLocale(locale);
  const e = await findEvent(slug);
  const s = await auth(); const signedIn = !!s?.user?.id;
  if (!e || ((!e.published || e.cancelledAt) && !canPerm(s?.user?.permissions, "events", "view"))) notFound(); // drafts and cancelled events: staff with events.view only
  const t = await getTranslations("events");
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
  const loc = eventLocation(e, t("venueTbc"));
  const where = locationRepeatsFormat(loc, e, locale) ? null : loc; // "Online" location for an online event: shown once (Format)
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
    <main id="main" tabIndex={-1} className="event-detail">
      <section className="page-hero"><div className="container">
        <span className="eyebrow">{t("eyebrow")}</span>
        <div className="tags ev-hero-tags">
          <span className={eventTypeBadgeClass}>{evLabel(e.type, locale)}</span>
          {statusLabel ? <span className="status status-dev">{statusLabel}</span>
            : v.past ? <span className="status status-neutral">{t("past")}</span>
            : open && e.memberPriceCents === 0 ? <span className="status status-available">{t("membersFree")}</span> : null}
        </div>
        <h1>{v.title}</h1>
        <p className="lead">{locale === "fr" && e.summaryFr ? e.summaryFr : e.summary}</p>
        {/* Small screens: the registration card sits below the details, so link to it from the hero. */}
        {(open || confirmed) && <a className="btn btn-secondary ev-jump" href="#register">{confirmed ? t("yourRegistration") : t("register")}</a>}
      </div></section>
      <section className="section"><div className="container layout-aside">
        <div>
          {v.planned && <div className="alert alert-info ev-planned" role="note"><Icon name="info" /><div><b>{t("plannedTitle")}</b>{t("plannedBody")}</div></div>}
          <h2 className="ev-h2">{t("details")}</h2>
          <dl className="ev-dl">{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
          <p className="small muted ev-note">{t("note")}{!v.planned && <> {t("tzNote")}</>}</p>
        </div>
        <aside><div className="card sticky-side ev-reg" id="register">
          {/* The aside's title names what it holds in each state (existing keys): your registration, ticket prices for an
              unconfirmed event (announced later), a past event, otherwise Register. */}
          <h2 className="ev-h3">{confirmed ? t("yourRegistration") : v.planned ? t("pricing") : v.past ? t("past") : t("register")}</h2>
          {!v.planned && <>
            <h3 className="label">{t("pricing")}</h3>
            <ul className="ev-prices">
              <li className={signedIn && isMember ? "is-mine" : ""}><span>{t("member")}{signedIn && isMember && <span className="badge badge-green">{t("yourPrice")}</span>}</span><b>{price(e.memberPriceCents)}</b></li>
              <li className={signedIn && !isMember ? "is-mine" : ""}><span>{t("nonMember")}{signedIn && !isMember && <span className="badge badge-green">{t("yourPrice")}</span>}</span><b>{price(e.publicPriceCents)}</b></li>
            </ul>
          </>}

          {confirmed ? (
            <>
              {(() => {
                const notice = <div className="alert alert-success" role="status"><Icon name="check-circle" /><div><b>{t("registered")}</b>{t("registeredBody")} <a className="link-arrow" href={`/${locale}/my/events`}>{t("myEvents")}</a></div></div>;
                // just registered (?registered=1, the action's redirect): focus the outcome; otherwise it is a standing notice
                return sp.registered ? <FocusOnLoad>{notice}</FocusOnLoad> : notice;
              })()}
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
                ? <p className="small muted ev-hint">{t("membersOnlyHint")} {t("notMember")} <a className="link-arrow" href={`/${locale}/join`}>{t("joinLink")}</a></p>
                : <p className="small muted ev-hint">{t("signInHint")} {t("notMember")} <a className="link-arrow" href={`/${locale}/join`}>{t("joinLink")}</a></p>}
            </>
          ) : myPrice === null ? (
            <div className="alert alert-info" role="note"><div>{t("tbcBlocked")} <a className="link-arrow" href={`/${locale}/join`}>{t("joinLink")}</a></div></div>
          ) : (
            <>
              {pendingPay && <div className="alert alert-warning" role="status"><div>{t("pending")}</div></div>}
              {sp.error === "pay" && <FocusOnLoad><div className="alert alert-danger" role="alert"><Icon name="x-circle" /><div>{t("payError")}</div></div></FocusOnLoad>}
              {sp.error === "tbc" && <FocusOnLoad><div className="alert alert-danger" role="alert"><Icon name="x-circle" /><div>{t("tbcBlocked")}</div></div></FocusOnLoad>}
              <form action={register}><input type="hidden" name="slug" value={e.slug} /><input type="hidden" name="locale" value={locale} />
                <button className="btn btn-accent btn-block">{pendingPay ? t("completePayment") : myPrice ? `${t("payAndRegister")} · ${fmt(myPrice, eventCurrency, locale)}` : t("registerFree")}</button>
              </form>
              {!isMember && myPrice > e.memberPriceCents && <p className="small muted ev-hint">{t("memberHint")} <a className="link-arrow" href={`/${locale}/join`}>{t("joinLink")}</a></p>}
            </>
          )}
        </div></aside>
      </div></section>
    </main>
  );
}
