import { sendEmail, renderEmail, siteUrl, contactInbox } from "@/lib/email";
import { db } from "@/lib/db";
import { eventTimeZone } from "@/lib/time";

/**
 * Account emails (round 8, EMAIL_SPEC §2.7–2.12, W3): welcome, password reset link and security notices. Called AFTER the
 * business change committed. Every notifyX catches its own errors and never throws (E2). Passwords are never emailed; the reset
 * token is only in the link and is never logged. Callers skip deleted accounts and inactive Admin Portal accounts.
 * Emails a visitor can trigger for any address greet with "Hello," and echo nothing that was typed (anti-abuse rule, §0.8).
 */

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: eventTimeZone });
const dayTime = (d: Date) => `${day(d)} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: eventTimeZone })} ET`;
const L = (path: string) => siteUrl(`/en${path}`);
/** The new address as shown to the OLD one: first character of the local part, then •••@domain. */
export const maskEmail = (email: string) => { const at = email.lastIndexOf("@"); return at < 1 ? "•••" : `${email.slice(0, 1)}•••@${email.slice(at + 1)}`; };
const fail = (kind: string, e: unknown) => console.error(`[notify] ${kind}: ${e instanceof Error ? e.name : "error"}`);

const SECURITY_FOOTER = "This is a security notice about your ADAIG account. We send these whenever an important account setting changes.";

const COPY = {
  en: {
    welcome: {
      subject: "Welcome to ADAIG: your account is ready",
      preheader: "Your free ADAIG guest account is ready to use.",
      heading: "Your account is ready",
      paragraphs: [
        "Hello,",
        "Thank you for creating a free guest account with the Association for Data and AI Governance (ADAIG). You can now register for events and webinars open to non-members, and follow your registrations and CPE hours in your account.",
        "A guest account is free but isn’t a membership. To become a member, apply from the Membership page on our website. There’s no payment when you apply, and our team will be in touch.",
      ],
      facts: (email: string, at: Date) => [{ label: "Account email", value: email }, { label: "Account type", value: "Free guest account" }, { label: "Created", value: day(at) }],
      cta: "Go to your account",
      footer: "You received this email because this address was used to create an ADAIG account. If you didn’t create it, reply to this email and we’ll help.",
    },
    resetLink: {
      subject: "Reset your ADAIG password",
      preheader: "Use this link within 60 minutes to choose a new password.",
      heading: "Reset your password",
      paragraphs: (expiresAt: Date) => [
        "Hello,",
        "We received a request to reset the password for the ADAIG account that uses this email address. Use the button below to choose a new password.",
        `The link works once and expires in 60 minutes, at ${dayTime(expiresAt)}. If it has expired, request a new one from the sign-in page.`,
        "If you didn’t ask to reset your password, you can ignore this email: your password won’t change.",
      ],
      facts: (email: string, createdAt: Date, expiresAt: Date) => [{ label: "Account", value: email }, { label: "Requested", value: dayTime(createdAt) }, { label: "Link expires", value: dayTime(expiresAt) }],
      cta: "Choose a new password",
      footer: "This is a security email about your ADAIG account. We send it whenever someone asks to reset the password for this address.",
    },
    changed: {
      subject: "Your ADAIG password was changed",
      preheader: (at: Date) => `The password for your ADAIG account was changed on ${day(at)}.`,
      heading: "Your password was changed",
      via: { profile: "in Profile & privacy", reset_link: "using a password reset link" },
      paragraphs: (at: Date, via: string) => [
        "Hello,",
        `The password for your ADAIG account was changed on ${dayTime(at)} ${via}. You’ve been signed out on every device. Sign in again with your new password.`,
        "If you didn’t make this change, reset your password right away with “Forgot your password?” on the sign-in page, then reply to this email so our team can help secure your account.",
      ],
      facts: (email: string, at: Date) => [{ label: "Account", value: email }, { label: "Changed", value: dayTime(at) }],
      cta: "Sign in",
    },
    resetByStaff: {
      subject: "Your ADAIG password was reset",
      preheader: { member: "The ADAIG team set a temporary password for your account.", admin: "An administrator set a new password for your Admin Portal account." },
      heading: "Your password was reset",
      paragraphs: (name: string, at: Date, variant: "member" | "admin") => [
        `Hello ${name},`,
        variant === "member"
          ? `A member of the ADAIG team set a temporary password for your ADAIG account on ${dayTime(at)}. For your security, this email doesn’t include the password: the team will give it to you directly.`
          : `An administrator set a new password for your ADAIG Admin Portal account on ${dayTime(at)}. For your security, this email doesn’t include the password: ask the administrator who reset it.`,
        variant === "member"
          ? "You’ve been signed out on every device. After you sign in with the temporary password, change it in Profile & privacy."
          : "You’ve been signed out on every device. Sign in with the new password; you can change it in Profile & privacy.",
        "If you didn’t expect this, reply to this email so our team can check your account.",
      ],
      facts: (email: string, at: Date) => [{ label: "Account", value: email }, { label: "Reset on", value: dayTime(at) }],
      cta: "Sign in",
    },
    emailChanged: {
      subject: "Your ADAIG sign-in email was changed",
      preheader: (at: Date) => `The email address for your ADAIG account was changed on ${day(at)}.`,
      heading: "Your sign-in email was changed",
      paragraphs: (name: string, at: Date, masked: string, variant: "member" | "admin") => [
        `Hello ${name},`,
        variant === "member"
          ? `The ADAIG team changed the email address you use to sign in to ADAIG on ${dayTime(at)}. From now on, sign in with ${masked}. Future emails about your account will go to the new address.`
          : `An administrator changed the email address you use to sign in to the ADAIG Admin Portal on ${dayTime(at)}. From now on, sign in with ${masked}. Future emails about your account will go to the new address.`,
        "If you didn’t ask for this change, reply to this email right away so our team can secure your account.",
      ],
      facts: (oldEmail: string, masked: string, at: Date) => [{ label: "Previous email", value: oldEmail }, { label: "New email", value: masked }, { label: "Changed", value: dayTime(at) }],
      cta: "Contact the ADAIG team",
      footer: "This is a security notice sent to the previous email address of your ADAIG account.",
    },
    deleted: {
      subject: "Your ADAIG account has been deleted",
      preheader: "Your ADAIG account and personal details have been removed.",
      heading: "Your account has been deleted",
      paragraphs: (at: Date, variant: "self" | "staff") => [
        "Hello,",
        variant === "self" ? `As you requested, your ADAIG account was deleted on ${dayTime(at)}.` : `Your ADAIG account was deleted by the ADAIG team on ${dayTime(at)}.`,
        "We removed your name, contact details, profile, CPE record and preferences. Any active membership or pending application was canceled. Payment records (for example, paid event registrations) and the audit log are kept in anonymized form, as required for tax and financial record-keeping.",
        "You can no longer sign in with this email address. You’re welcome to create a new account at any time.",
        "If you didn’t ask for this, or have questions about your data, reply to this email.",
      ],
      facts: (email: string, at: Date) => [{ label: "Account", value: email }, { label: "Deleted", value: dayTime(at) }],
      cta: "Contact the ADAIG team",
      footer: "You received this email because the ADAIG account that used this address was deleted. This is the last email about that account.",
    },
  },
};
type Locale = keyof typeof COPY;
const copy = (locale: string = "en") => COPY[locale as Locale] ?? COPY.en;
const team = () => contactInbox() ?? undefined;

/** signup.welcome (T7): a free guest account was created. */
export async function notifySignupWelcome(d: { userId: string; email: string; createdAt: Date }): Promise<void> {
  try {
    const c = copy().welcome;
    const { html, text } = renderEmail({ preheader: c.preheader, heading: c.heading, paragraphs: c.paragraphs, facts: c.facts(d.email, d.createdAt),
      cta: { label: c.cta, url: L("/my/billing") }, footerNote: c.footer, locale: "en" });
    await sendEmail({ kind: "signup.welcome", to: d.email, subject: c.subject, html, text, replyTo: team(), dedupeKey: `signup.welcome:${d.userId}`, userId: d.userId });
  } catch (e) { fail("signup.welcome", e); }
}

/** password.reset_link (T8, scheduled with after()): the raw token goes only into the link. */
export async function notifyPasswordResetLink(d: { to: string; userId: string; token: string; tokenId: string; createdAt: Date; expiresAt: Date }): Promise<void> {
  try {
    const c = copy().resetLink;
    const { html, text } = renderEmail({ preheader: c.preheader, heading: c.heading, paragraphs: c.paragraphs(d.expiresAt), facts: c.facts(d.to, d.createdAt, d.expiresAt),
      cta: { label: c.cta, url: L(`/reset-password?token=${d.token}`) }, footerNote: c.footer, locale: "en" });
    await sendEmail({ kind: "password.reset_link", to: d.to, subject: c.subject, html, text, replyTo: team(), dedupeKey: `password.reset_link:${d.tokenId}`, userId: d.userId });
  } catch (e) { fail("password.reset_link", e); }
}

/** password.changed (T9 reset link, T10 Profile & privacy). */
export async function notifyPasswordChanged(d: { userId: string; email: string; at: Date; via: "profile" | "reset_link"; auditId: string }): Promise<void> {
  try {
    const c = copy().changed;
    const { html, text } = renderEmail({ preheader: c.preheader(d.at), heading: c.heading, paragraphs: c.paragraphs(d.at, c.via[d.via]), facts: c.facts(d.email, d.at),
      cta: { label: c.cta, url: L("/login") }, footerNote: SECURITY_FOOTER, locale: "en" });
    await sendEmail({ kind: "password.changed", to: d.email, subject: c.subject, html, text, replyTo: team(), dedupeKey: `password.changed:${d.auditId}`, userId: d.userId });
  } catch (e) { fail("password.changed", e); }
}

/** password.reset_by_staff (T12 Members temporary password, T15 Users reset). Never contains the password. */
export async function notifyPasswordResetByStaff(d: { userId: string; email: string; name: string; variant: "member" | "admin"; at: Date; auditId: string }): Promise<void> {
  try {
    const c = copy().resetByStaff;
    const { html, text } = renderEmail({ preheader: c.preheader[d.variant], heading: c.heading, paragraphs: c.paragraphs(d.name, d.at, d.variant), facts: c.facts(d.email, d.at),
      cta: { label: c.cta, url: L("/login") }, footerNote: SECURITY_FOOTER, locale: "en" });
    await sendEmail({ kind: "password.reset_by_staff", to: d.email, subject: c.subject, html, text, replyTo: team(), dedupeKey: `password.reset_by_staff:${d.auditId}`, userId: d.userId });
  } catch (e) { fail("password.reset_by_staff", e); }
}

/** email.changed (T13 Members, T16 Users): to the OLD address; the new one is shown masked only. */
export async function notifyEmailChanged(d: { userId: string; name: string; oldEmail: string; newEmail: string; variant: "member" | "admin"; at: Date; auditId: string }): Promise<void> {
  try {
    const c = copy().emailChanged; const masked = maskEmail(d.newEmail);
    const { html, text } = renderEmail({ preheader: c.preheader(d.at), heading: c.heading, paragraphs: c.paragraphs(d.name, d.at, masked, d.variant), facts: c.facts(d.oldEmail, masked, d.at),
      cta: { label: c.cta, url: L("/contact?topic=account") }, footerNote: c.footer, locale: "en" });
    await sendEmail({ kind: "email.changed", to: d.oldEmail, subject: c.subject, html, text, replyTo: team(), dedupeKey: `email.changed:${d.auditId}`, userId: d.userId });
  } catch (e) { fail("email.changed", e); }
}

/**
 * account.deleted (T11 self, T14 staff): to the pre-deletion address. Afterwards the EmailLog row's address is replaced with
 * the same anonymous address deleteUserAccount uses, so the log keeps no address of a deleted account.
 */
export async function notifyAccountDeleted(d: { userId: string; email: string; variant: "self" | "staff"; at: Date }): Promise<void> {
  const dedupeKey = `account.deleted:${d.userId}`;
  try {
    const c = copy().deleted;
    const { html, text } = renderEmail({ preheader: c.preheader, heading: c.heading, paragraphs: c.paragraphs(d.at, d.variant), facts: c.facts(d.email, d.at),
      cta: { label: c.cta, url: L("/contact?topic=privacy") }, footerNote: c.footer, locale: "en" });
    await sendEmail({ kind: "account.deleted", to: d.email, subject: c.subject, html, text, replyTo: team(), dedupeKey, userId: d.userId });
  } catch (e) { fail("account.deleted", e); }
  try {
    await db.emailLog.updateMany({ where: { dedupeKey }, data: { toEmail: `deleted-${d.userId}@deleted.invalid` } });
  } catch (e) { fail("account.deleted (log)", e); }
}
