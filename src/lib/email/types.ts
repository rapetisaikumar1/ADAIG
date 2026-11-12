/** Kinds of outgoing email (EmailLog.kind). Other strings are accepted too; keep them "area.event". */
export type EmailKind =
  | "contact.notify" | "contact.ack"
  | "join.ack" | "join.notify" | "membership.approved" | "membership.rejected"
  | "signup.welcome"
  | "password.reset_link" | "password.changed" | "password.reset_by_staff" | "email.changed" | "account.deleted"
  | "event.registered" | "event.cancelled"
  | "membership.renewal_due" | "membership.lapsed"
  | "test"
  | (string & {});

export type SendEmailInput = {
  kind: EmailKind;
  /** One recipient address; validated (invalid → "failed", nothing sent). */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Applied only when it is a valid address (otherwise left out). */
  replyTo?: string;
  /** Unique across EmailLog: a key already sent (or in flight) → "duplicate". A key whose earlier attempt failed/skipped is retried. */
  dedupeKey?: string;
  /** The recipient's user id when known (EmailLog.userId). */
  userId?: string;
};

export type SendEmailResult = { status: "sent" | "failed" | "skipped" | "duplicate"; messageId?: string; error?: string };
