/**
 * Outgoing email (round 8): server-only. Import from "@/lib/email". Nothing else in the app imports nodemailer.
 * API: SP/r8/email-api.md · README → Email (SMTP).
 */
export { sendEmail, redactEmailLog } from "./send";
export { renderEmail, escapeHtml } from "./layout";
export type { EmailFact, EmailCta, RenderEmailInput } from "./layout";
export { emailConfig, contactInbox, siteUrl, ASSOCIATION_NAME, ASSOCIATION_SHORT } from "./config";
export type { EmailConfig } from "./config";
export type { EmailKind, SendEmailInput, SendEmailResult } from "./types";
