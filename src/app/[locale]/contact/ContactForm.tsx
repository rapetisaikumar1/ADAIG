"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { sendContact, type ContactField, type ContactState } from "./actions";

const TOPICS = ["membership", "enterprise", "events", "chapters", "community", "volunteering", "media", "privacy", "account", "other"] as const;

export function ContactForm({ locale, initialTopic, defaults }: { locale: string; initialTopic?: string; defaults: { name?: string; email?: string; org?: string } }) {
  const t = useTranslations("contact");
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContact, {});
  // Submit through a transition so a validation error keeps what the visitor typed (React 19 resets form fields after an action).
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if ((state.error && !pending) || state.ok) statusRef.current?.focus(); }, [state, pending]);
  const topic = (TOPICS as readonly string[]).includes(initialTopic ?? "") ? initialTopic : "";
  // Field-level errors: the server names the field; mark it invalid and tie the message to it (A1-14).
  const bad = (f: ContactField) => state.field === f;
  const desc = (f: ContactField, ...ids: string[]) => [bad(f) && `cf-${f}-err`, ...ids].filter(Boolean).join(" ") || undefined;
  const fieldErr = (f: ContactField) => bad(f) ? <span className="error-msg" id={`cf-${f}-err`}>{state.error}</span> : null;
  const fcls = (f: ContactField) => `field${bad(f) ? " error" : ""}`;
  const fieldId: Record<ContactField, string> = { name: "cf-name", email: "cf-email", organization: "cf-org", topic: "cf-topic", message: "cf-msg", consent: "cf-consent" };

  if (state.ok) {
    return (
      <div className="alert alert-success contact-sent" role="status" tabIndex={-1} ref={statusRef}>
        <div><b>{t("sentTitle")}</b>{t("sentBody")}</div>
      </div>
    );
  }
  return (
    <form action={action} onSubmit={submit} className="contact-form" aria-labelledby="cf-h" noValidate={false}>
      <input type="hidden" name="locale" value={locale} />
      <h2 id="cf-h">{t("formTitle")}</h2>
      <p className="muted">{t("formLead")}</p>
      {/* Hidden while sending, so the alert mounts again with the result and a repeated error is announced again. */}
      {state.error && !pending && <div className="alert alert-danger" role="alert" tabIndex={-1} ref={statusRef}><div>{state.field ? <a href={`#${fieldId[state.field]}`}>{state.error}</a> : state.error}</div></div>}
      <div className="grid g2 contact-row">
        <div className={fcls("name")}><label htmlFor="cf-name">{t("name")}</label><input id="cf-name" name="name" type="text" required maxLength={100} autoComplete="name" defaultValue={defaults.name} aria-invalid={bad("name") || undefined} aria-describedby={desc("name")} />{fieldErr("name")}</div>
        <div className={fcls("email")}><label htmlFor="cf-email">{t("email")}</label><input id="cf-email" name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={defaults.email} aria-invalid={bad("email") || undefined} aria-describedby={desc("email")} />{fieldErr("email")}</div>
      </div>
      <div className="grid g2 contact-row">
        <div className={fcls("organization")}><label htmlFor="cf-org">{t("organization")} <span className="muted">{t("optional")}</span></label><input id="cf-org" name="organization" type="text" maxLength={150} autoComplete="organization" defaultValue={defaults.org} aria-invalid={bad("organization") || undefined} aria-describedby={desc("organization")} />{fieldErr("organization")}</div>
        <div className={fcls("topic")}><label htmlFor="cf-topic">{t("topic")}</label>
          <select id="cf-topic" name="topic" required defaultValue={topic} aria-invalid={bad("topic") || undefined} aria-describedby={desc("topic")}>
            <option value="" disabled>{t("chooseTopic")}</option>
            {TOPICS.map((k) => <option key={k} value={k}>{t(`topic_${k}`)}</option>)}
          </select>{fieldErr("topic")}</div>
      </div>
      <div className={fcls("message")}><label htmlFor="cf-msg">{t("message")}</label><textarea id="cf-msg" name="message" required minLength={10} maxLength={3000} rows={7} aria-invalid={bad("message") || undefined} aria-describedby={desc("message", "cf-msg-hint")} /><span className="hint" id="cf-msg-hint">{t("messageHint")}</span>{fieldErr("message")}</div>
      {/* Honeypot for bots — hidden from people and assistive tech. */}
      <div className="contact-hp" aria-hidden="true"><label htmlFor="cf-web">Website</label><input id="cf-web" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
      <label className="check"><input id="cf-consent" type="checkbox" name="consent" required aria-invalid={bad("consent") || undefined} aria-describedby={desc("consent")} /> <span>{t("consent")} <a href={`/${locale}/legal#privacy`}>{t("privacyLink")}</a></span></label>
      {fieldErr("consent")}
      <div className="contact-actions"><button className="btn btn-accent" disabled={pending}>{pending ? t("sending") : t("send")}</button><span className="small muted">{t("responseNote")}</span></div>
    </form>
  );
}
