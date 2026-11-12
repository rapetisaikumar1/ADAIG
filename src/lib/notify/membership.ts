import { db } from "@/lib/db";
import { sendEmail, renderEmail, siteUrl, contactInbox, type EmailFact, type SendEmailResult } from "@/lib/email";
import { getTier, tierLookup } from "@/lib/settings";
import { LAPSE_GRACE_DAYS } from "@/lib/membership";
import { eventTimeZone, zoneDay } from "@/lib/time";
import { rejectionReasonText } from "@/app/[locale]/my/_shared/util";
import { subdivisionsFor } from "@/config/site";
/**
 * Membership emails (round 8, EMAIL_SPEC §2.3–2.6, 2.15, 2.16). Every function here is called AFTER the business action
 * committed and never throws (E2): a failed send is recorded in EmailLog by sendEmail and the flow carries on.
 * - notifyApplication: join.ack (applicant) + join.notify (ADAIG inbox), from /join (startJoin).
 * - notifyReview: membership.approved / membership.rejected, from Admin → Members (reviewEligibility).
 * - sendMembershipLifecycleEmails: membership.renewal_due + membership.lapsed, from the daily cron
 *   (src/app/api/cron/expire-unpaid-orders/route.ts). No backlog (decision Q3): reminders only for renewal dates that passed
 *   within the last RENEWAL_REMINDER_DAYS days, lapse notices only for automatic lapses of the last LAPSED_NOTICE_DAYS days.
 *   Dedupe keys make re-runs send nothing twice.
 * Copy is English only (E5), kept in COPY so French can be added later; links use the /en prefix.
 */

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: eventTimeZone }); // December 8, 2026
const dayTime = (d: Date) => `${day(d)} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ET`; // December 8, 2026 at 2:15 PM ET
const L = (p: string) => siteUrl("/en" + p);
const DAY_MS = 864e5;

/** Reminder window after the renewal date (Q3: no backlog blast on the first production run). Never longer than the grace period. */
export const RENEWAL_REMINDER_DAYS = Math.min(14, LAPSE_GRACE_DAYS);
/** Lapse notices cover automatic lapses (audit "membership.lapsed_auto") from this many days back. */
export const LAPSED_NOTICE_DAYS = 7;
/** Per run and per kind: at most this many sends, and no new send after RUN_BUDGET_MS; the rest go out on the next run. */
const MAX_SENDS_PER_KIND = 100;
const RUN_BUDGET_MS = 40_000;

/** Recipients: never deleted accounts; never deactivated Admin Portal accounts (EMAIL_SPEC §0.6). */
type Recipient = { id: string; email: string; name: string | null; role: string; active?: boolean };
const reachable = (u: Recipient | null | undefined): u is Recipient => !!u && u.role !== "deleted" && !(u.role === "admin" && u.active === false);
const hello = (name: string | null) => (name?.trim() ? `Hello ${name.trim()},` : "Hello,");

const COPY = {
  en: {
    ack: {
      subject: "We’ve received your ADAIG membership application",
      preheader: (tier: string) => `Thank you for applying for ${tier} membership. Here’s what happens next.`,
      heading: "Thank you for applying",
      paragraphs: (tier: string, verify: boolean, isNew: boolean) => [
        "Hello,",
        `Thank you for applying for ${tier} membership with the Association for Data and AI Governance (ADAIG). We’ve received your application.`,
        "The ADAIG team reviews every application. A member of our team, your point of contact (POC), will then contact you to confirm your membership, dues and next steps. There’s nothing else you need to do for now.",
        "Nothing has been charged: there is no payment when you apply.",
        ...(verify ? ["Our team confirms student eligibility as part of reviewing your application and may ask you for proof of enrollment."] : []),
        ...(isNew ? ["We’ve also created your ADAIG account. Sign in with this email address and the password you chose to follow your application."] : []),
      ],
      facts: (tier: string, submitted: Date, email: string): EmailFact[] => [
        { label: "Tier", value: tier }, { label: "Status", value: "Under review" }, { label: "Submitted", value: day(submitted) }, { label: "Account email", value: email },
      ],
      cta: "View My membership",
      footer: "You received this email because this address was used to apply for ADAIG membership. If you didn’t apply, reply to this email and let us know.",
    },
    notify: {
      subject: (tier: string) => `New membership application: ${tier}`,
      preheader: (who: string, tier: string) => `${who} applied for ${tier} membership and is waiting for review.`,
      heading: "New membership application",
      paragraphs: (who: string, tier: string) => [
        `${who} applied for ${tier} membership. The application is waiting for review in Admin → Members.`,
        "Approve or reject it in the Admin Portal, then follow up with the applicant as their point of contact. Reply to this email to write to the applicant directly.",
      ],
      accountNew: "New account created with this application",
      accountExisting: "Existing account",
      cta: "Review the application",
      footer: "Sent to the ADAIG team inbox because a membership application was submitted on the ADAIG website.",
    },
    approved: {
      subject: "Welcome to ADAIG: your membership is active",
      preheader: (tier: string, renews: Date) => `Your ${tier} membership is active until ${day(renews)}.`,
      heading: "Your membership is active",
      paragraphs: (name: string | null, tier: string) => [
        hello(name),
        `Welcome to the Association for Data and AI Governance (ADAIG). Your application has been approved, and your ${tier} membership is now active.`,
        "As a member, you get the member price on ADAIG events (applied automatically when you’re signed in), you can browse the member directory and choose to be listed in it, and you can follow your registrations and CPE hours in your account.",
        "To appear in the member directory, turn on “List me in the member directory” in Profile & privacy.",
        "Membership fees aren’t paid online. The ADAIG team handles membership invoicing and renewals directly and will contact you by email.",
      ],
      facts: (tier: string, starts: Date, renews: Date): EmailFact[] => [
        { label: "Tier", value: tier }, { label: "Status", value: "Active" }, { label: "Member since", value: day(starts) }, { label: "Renewal date", value: day(renews) },
      ],
      cta: "Go to My membership",
      footer: "You received this email because you applied for ADAIG membership.",
    },
    rejected: {
      subject: "Update on your ADAIG membership application",
      preheader: (tier: string) => `Your application for ${tier} membership was not approved.`,
      heading: "Your application wasn’t approved",
      paragraphs: (name: string | null, tier: string, reason: string | null, flag: boolean, paid: boolean) => [
        hello(name),
        `Thank you for your interest in the Association for Data and AI Governance (ADAIG). After reviewing your application for ${tier} membership, the ADAIG team wasn’t able to approve it.`,
        rejectionReasonText(reason, (r) => `Reason: ${r}`, "No reason was given."),
        ...(flag ? ["Your payment has been flagged for a manual refund. The ADAIG team will process it and contact you."]
          : paid ? ["Contact the ADAIG team if you have questions about your payment."] : []),
        "Your ADAIG account stays open as a free account. You can apply under another tier instead, or reply to this email if you have any questions.",
      ],
      facts: (tier: string, applied: Date): EmailFact[] => [
        { label: "Tier", value: tier }, { label: "Status", value: "Not approved" }, { label: "Applied on", value: day(applied) },
      ],
      cta: "View My membership",
      footer: "You received this email because you applied for ADAIG membership.",
    },
    renewalDue: {
      subject: "Your ADAIG membership is due for renewal",
      preheader: (tier: string, renews: Date) => `Your ${tier} membership was due for renewal on ${day(renews)}.`,
      heading: "Your membership is due for renewal",
      paragraphs: (name: string | null, tier: string, renews: Date, lapseOn: Date) => [
        hello(name),
        `Your ${tier} membership was due for renewal on ${day(renews)}. Renewal isn’t handled online: the ADAIG team will contact you about renewing.`,
        `Your membership stays active during a ${LAPSE_GRACE_DAYS}-day grace period. If it isn’t renewed by ${day(lapseOn)}, it will lapse.`,
        "Questions about renewing? Reply to this email or contact the ADAIG team.",
      ],
      facts: (tier: string, renews: Date, lapseOn: Date): EmailFact[] => [
        { label: "Tier", value: tier }, { label: "Renewal date", value: day(renews) }, { label: "Grace period ends", value: day(lapseOn) },
      ],
      cta: "Go to My membership",
      footer: "You received this email because you have an ADAIG membership.",
    },
    lapsed: {
      subject: "Your ADAIG membership has lapsed",
      preheader: (tier: string) => `Your ${tier} membership lapsed because it wasn’t renewed.`,
      heading: "Your membership has lapsed",
      paragraphs: (name: string | null, tier: string, lapsedOn: Date, guest: boolean) => [
        hello(name),
        `Your ${tier} membership lapsed on ${day(lapsedOn)} because it wasn’t renewed by the end of the grace period.`,
        ...(guest ? ["Your ADAIG account stays open as a free guest account: you can still sign in, register for events open to non-members and see your CPE record. Member pricing and the member directory are no longer available."] : []),
        "The ADAIG team can renew your membership for you. Reply to this email or contact us to get started.",
      ],
      facts: (tier: string, renews: Date | null): EmailFact[] => [
        { label: "Tier", value: tier }, { label: "Status", value: "Lapsed" }, ...(renews ? [{ label: "Renewal was due", value: day(renews) }] : []),
      ],
      cta: "Contact the ADAIG team",
      footer: "You received this email because you had an ADAIG membership.",
    },
  },
};
type Copy = (typeof COPY)["en"];
const copy = (locale = "en"): Copy => (COPY as Record<string, Copy>)[locale] ?? COPY.en;

/** "Ontario (ON)" for the stored code; the code alone when it is not in the list. */
const subdivisionName = (country: string, code: string) => {
  const s = subdivisionsFor(country)?.find((x) => x.code === code);
  return s ? `${s.name} (${s.code})` : code;
};
const tierName = async (tierId: string) => (await getTier(tierId))?.name.en ?? tierId;

// ── Join application ────────────────────────────────────────────────────────────────────────────────────────────────

export type ApplicationNotice = {
  membershipId: string; createdAt: Date; userId: string;
  /** The account email (known for a new account; looked up for a signed-in applicant when left out). */
  email?: string | null;
  isNewAccount: boolean;
  tierName: string; requiresVerification: boolean;
  first: string; last: string; organisation: string; country: string; province: string | null; institution: string | null;
};

/** join.ack to the applicant + join.notify to the ADAIG inbox (skipped when CONTACT_TO_EMAIL is not set). Never throws. */
export async function notifyApplication(d: ApplicationNotice): Promise<void> {
  try {
    const email = d.email ?? (await db.user.findUnique({ where: { id: d.userId }, select: { email: true } }))?.email;
    if (!email) { console.error("[notify] join.ack: applicant email not found"); return; }
    const c = copy(), team = contactInbox(), tier = d.tierName, verify = d.requiresVerification;
    const sends: Promise<SendEmailResult>[] = [];

    const ack = renderEmail({
      preheader: c.ack.preheader(tier), heading: c.ack.heading, paragraphs: c.ack.paragraphs(tier, verify, d.isNewAccount),
      facts: c.ack.facts(tier, d.createdAt, email), cta: { label: c.ack.cta, url: L("/my/billing") }, footerNote: c.ack.footer, locale: "en",
    });
    sends.push(sendEmail({ kind: "join.ack", to: email, subject: c.ack.subject, ...ack, replyTo: team ?? undefined, dedupeKey: `join.ack:${d.membershipId}`, userId: d.userId }));

    if (team) {
      const who = `${d.first} ${d.last}`;
      const facts: EmailFact[] = [
        { label: "Name", value: who }, { label: "Email", value: email }, { label: "Tier", value: tier },
        { label: "Organization", value: d.organisation }, { label: "Country", value: d.country },
        ...(d.province ? [{ label: "State / province", value: subdivisionName(d.country, d.province) }] : []),
        ...(verify && d.institution ? [{ label: "Institution", value: d.institution }] : []),
        { label: "Account", value: d.isNewAccount ? c.notify.accountNew : c.notify.accountExisting },
        { label: "Submitted", value: dayTime(d.createdAt) },
      ];
      const n = renderEmail({
        preheader: c.notify.preheader(who, tier), heading: c.notify.heading, paragraphs: c.notify.paragraphs(who, tier), facts,
        cta: { label: c.notify.cta, url: L(`/admin/members/${encodeURIComponent(d.userId)}#memberships`) }, footerNote: c.notify.footer, locale: "en",
      });
      sends.push(sendEmail({ kind: "join.notify", to: team, subject: c.notify.subject(tier), ...n, replyTo: email, dedupeKey: `join.notify:${d.membershipId}` }));
    }
    await Promise.all(sends);
  } catch (e) {
    console.error("[notify] join.ack/join.notify:", (e as Error)?.name ?? "error");
  }
}

// ── Staff decision on an application ────────────────────────────────────────────────────────────────────────────────

export type ReviewNotice =
  | { decision: "approve"; membershipId: string; userId: string; tierId: string; startsAt: Date; renewsAt: Date }
  | { decision: "reject"; membershipId: string; userId: string; tierId: string; createdAt: Date; reason: string | null; flag: boolean; paymentRef: string | null };

/** membership.approved / membership.rejected to the member (not to deleted accounts). Never throws. */
export async function notifyReview(d: ReviewNotice): Promise<void> {
  const kind = d.decision === "approve" ? "membership.approved" : "membership.rejected";
  try {
    const u = await db.user.findUnique({ where: { id: d.userId }, select: { id: true, email: true, name: true, role: true, active: true } });
    if (!reachable(u)) return;
    const c = copy(), tier = await tierName(d.tierId), team = contactInbox() ?? undefined;
    if (d.decision === "approve") {
      const r = renderEmail({
        preheader: c.approved.preheader(tier, d.renewsAt), heading: c.approved.heading, paragraphs: c.approved.paragraphs(u.name, tier),
        facts: c.approved.facts(tier, d.startsAt, d.renewsAt), cta: { label: c.approved.cta, url: L("/my/billing") }, footerNote: c.approved.footer, locale: "en",
      });
      await sendEmail({ kind, to: u.email, subject: c.approved.subject, ...r, replyTo: team, dedupeKey: `${kind}:${d.membershipId}`, userId: u.id });
    } else {
      const r = renderEmail({
        preheader: c.rejected.preheader(tier), heading: c.rejected.heading,
        paragraphs: c.rejected.paragraphs(u.name, tier, d.reason, d.flag, !!d.paymentRef),
        facts: c.rejected.facts(tier, d.createdAt), cta: { label: c.rejected.cta, url: L("/my/billing") }, footerNote: c.rejected.footer, locale: "en",
      });
      await sendEmail({ kind, to: u.email, subject: c.rejected.subject, ...r, replyTo: team, dedupeKey: `${kind}:${d.membershipId}`, userId: u.id });
    }
  } catch (e) {
    console.error(`[notify] ${kind}:`, (e as Error)?.name ?? "error");
  }
}

// ── Daily cron: renewal reminders and lapse notices ─────────────────────────────────────────────────────────────────

export type SendCounts = { sent: number; failed: number; skipped: number; duplicate: number };
export type LifecycleEmailCounts = { renewalDue: SendCounts; lapsed: SendCounts };
const zero = (): SendCounts => ({ sent: 0, failed: 0, skipped: 0, duplicate: 0 });

/** Keys already delivered (status "sent") — dropped before the cap, so old rows never use up a run's quota. */
async function alreadySent(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await db.emailLog.findMany({ where: { dedupeKey: { in: keys }, status: "sent" }, select: { dedupeKey: true } });
  return new Set(rows.map((r) => r.dedupeKey!));
}

/**
 * The cron's email step: membership.renewal_due for active memberships whose renewal date passed within the last
 * RENEWAL_REMINDER_DAYS days (one per renewal period: key membershipId + renewal day), and membership.lapsed for automatic lapses
 * (audit "membership.lapsed_auto", also written by the lazy housekeeping and `npm run expire-unpaid-orders`) from the last
 * LAPSED_NOTICE_DAYS days (key = audit row id). Staff-marked lapses are not emailed. Never throws: an unexpected error
 * is logged and the counts so far are returned.
 */
export async function sendMembershipLifecycleEmails(now = new Date()): Promise<LifecycleEmailCounts> {
  const started = Date.now();
  const out: LifecycleEmailCounts = { renewalDue: zero(), lapsed: zero() };
  const inBudget = () => Date.now() - started < RUN_BUDGET_MS;
  const c = copy(), team = contactInbox() ?? undefined;
  let tierOf: (id: string) => { name: { en: string } } | undefined = () => undefined;
  try { tierOf = await tierLookup(); } catch { /* tier ids are shown instead */ }
  const tier = (id: string) => tierOf(id)?.name.en ?? id;

  try {
    const due = await db.membership.findMany({
      where: { status: "active", renewsAt: { lt: now, gte: new Date(+now - RENEWAL_REMINDER_DAYS * DAY_MS) }, user: { role: { not: "deleted" } } },
      include: { user: { select: { id: true, email: true, name: true, role: true, active: true } } }, orderBy: { renewsAt: "asc" },
    });
    const list = due.filter((m) => reachable(m.user)).map((m) => ({ m, key: `membership.renewal_due:${m.id}:${zoneDay(m.renewsAt!)}` }));
    const sent = await alreadySent(list.map((x) => x.key));
    for (const { m, key } of list.filter((x) => !sent.has(x.key)).slice(0, MAX_SENDS_PER_KIND)) {
      if (!inBudget()) break;
      const renews = m.renewsAt!, lapseOn = new Date(+renews + LAPSE_GRACE_DAYS * DAY_MS), t = tier(m.tierId);
      const r = renderEmail({
        preheader: c.renewalDue.preheader(t, renews), heading: c.renewalDue.heading, paragraphs: c.renewalDue.paragraphs(m.user.name, t, renews, lapseOn),
        facts: c.renewalDue.facts(t, renews, lapseOn), cta: { label: c.renewalDue.cta, url: L("/my/billing") }, footerNote: c.renewalDue.footer, locale: "en",
      });
      const res = await sendEmail({ kind: "membership.renewal_due", to: m.user.email, subject: c.renewalDue.subject, ...r, replyTo: team, dedupeKey: key, userId: m.userId });
      out.renewalDue[res.status]++;
    }
  } catch (e) {
    console.error("[notify] membership.renewal_due:", (e as Error)?.name ?? "error");
  }

  try {
    const audits = await db.auditLog.findMany({
      where: { action: "membership.lapsed_auto", createdAt: { gte: new Date(+now - LAPSED_NOTICE_DAYS * DAY_MS), lte: now } },
      orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, target: true },
    });
    const ids = [...new Set(audits.map((a) => a.target).filter((x): x is string => !!x))];
    const ms = ids.length ? await db.membership.findMany({
      where: { id: { in: ids } },
      select: { id: true, tierId: true, renewsAt: true, status: true, userId: true, user: { select: { id: true, email: true, name: true, role: true, active: true } } },
    }) : [];
    const byId = new Map(ms.map((m) => [m.id, m]));
    const list = audits
      .map((a) => ({ a, m: a.target ? byId.get(a.target) : undefined, key: `membership.lapsed:${a.id}` }))
      .filter((x): x is typeof x & { m: NonNullable<typeof x.m> } => !!x.m && x.m.status === "lapsed" && reachable(x.m.user));
    const sent = await alreadySent(list.map((x) => x.key));
    for (const { a, m, key } of list.filter((x) => !sent.has(x.key)).slice(0, MAX_SENDS_PER_KIND)) {
      if (!inBudget()) break;
      const t = tier(m.tierId);
      const r = renderEmail({
        preheader: c.lapsed.preheader(t), heading: c.lapsed.heading, paragraphs: c.lapsed.paragraphs(m.user.name, t, a.createdAt, m.user.role === "guest"),
        facts: c.lapsed.facts(t, m.renewsAt), cta: { label: c.lapsed.cta, url: L("/contact?topic=membership") }, footerNote: c.lapsed.footer, locale: "en",
      });
      const res = await sendEmail({ kind: "membership.lapsed", to: m.user.email, subject: c.lapsed.subject, ...r, replyTo: team, dedupeKey: key, userId: m.userId });
      out.lapsed[res.status]++;
    }
  } catch (e) {
    console.error("[notify] membership.lapsed:", (e as Error)?.name ?? "error");
  }
  return out;
}
