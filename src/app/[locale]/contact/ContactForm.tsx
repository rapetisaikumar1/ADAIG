"use client";
import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { sendContact, type ContactState } from "./actions";

const TOPICS = ["membership", "enterprise", "events", "chapters", "community", "volunteering", "media", "privacy", "account", "other"] as const;

export function ContactForm({ locale, initialTopic, defaults }: { locale: string; initialTopic?: string; defaults: { name?: string; email?: string; org?: string } }) {
  const t = useTranslations("contact");
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContact, {});
  // Submit through a transition so a validation error keeps what the visitor typed (React 19 resets form fields after an action).
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); };
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error || state.ok) statusRef.current?.focus(); }, [state]);
  const topic = (TOPICS as readonly string[]).includes(initialTopic ?? "") ? initialTopic : "";

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
      {state.error && <div className="alert alert-danger" role="alert" tabIndex={-1} ref={statusRef}><div>{state.error}</div></div>}
      <div className="grid g2 contact-row">
        <div className="field"><label htmlFor="cf-name">{t("name")}</label><input id="cf-name" name="name" type="text" required maxLength={100} autoComplete="name" defaultValue={defaults.name} /></div>
        <div className="field"><label htmlFor="cf-email">{t("email")}</label><input id="cf-email" name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={defaults.email} /></div>
      </div>
      <div className="grid g2 contact-row">
        <div className="field"><label htmlFor="cf-org">{t("organization")} <span className="muted">{t("optional")}</span></label><input id="cf-org" name="organization" type="text" maxLength={150} autoComplete="organization" defaultValue={defaults.org} /></div>
        <div className="field"><label htmlFor="cf-topic">{t("topic")}</label>
          <select id="cf-topic" name="topic" required defaultValue={topic}>
            <option value="" disabled>{t("chooseTopic")}</option>
            {TOPICS.map((k) => <option key={k} value={k}>{t(`topic_${k}`)}</option>)}
          </select></div>
      </div>
      <div className="field"><label htmlFor="cf-msg">{t("message")}</label><textarea id="cf-msg" name="message" required minLength={10} maxLength={3000} rows={7} aria-describedby="cf-msg-hint" /><span className="hint" id="cf-msg-hint">{t("messageHint")}</span></div>
      {/* Honeypot for bots — hidden from people and assistive tech. */}
      <div className="contact-hp" aria-hidden="true"><label htmlFor="cf-web">Website</label><input id="cf-web" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
      <label className="check"><input type="checkbox" name="consent" required /> <span>{t("consent")} <a href={`/${locale}/legal#privacy`}>{t("privacyLink")}</a></span></label>
      <div className="contact-actions"><button className="btn btn-accent" disabled={pending}>{pending ? t("sending") : t("send")}</button><span className="small muted">{t("responseNote")}</span></div>
    </form>
  );
}
