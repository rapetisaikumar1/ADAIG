"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { auth, signIn } from "@/auth";
import { expireUnpaid, cancelUnpaid } from "@/lib/membership";
import { subdivisionsFor, defaultCurrency } from "@/config/site";
import { getTiers } from "@/lib/settings";
import { allowAccountCreation } from "@/lib/rateLimit";
import { getTranslations } from "next-intl/server";
import { checkPassword, emailOk, normEmail, cleanText, normCountry, normProvince, limits, isUniqueViolation, safeLocale, idParam } from "@/lib/validation";
import { notifyApplication } from "@/lib/notify/membership";

/** `field` is the id of the input the error is about (JoinForm marks it aria-invalid and links the message to it). */
export type JoinField = "tier" | "fn" | "ln" | "org" | "co" | "pr" | "inst" | "attest" | "em" | "pw";
export type JoinState = { error?: string; field?: JoinField };
const OPEN = ["pending", "pending_verification", "active"]; // statuses that block a new join (BUG-033)

/**
 * Membership application (data capture only, no payment). Creates the account if needed and a membership in
 * status "pending_verification" for ANY tier; staff approve or reject it in Admin → Members, and the ADAIG team
 * point of contact follows up with the applicant. Nothing is charged here: amount/tax are 0 and there is no paymentRef,
 * so a rejection never flags a refund and the application never shows up in dues totals.
 * Emails (round 8): an acknowledgement to the applicant and a notification to the ADAIG inbox (CONTACT_TO_EMAIL).
 */
export async function startJoin(_: JoinState, fd: FormData): Promise<JoinState> {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const t = await getTranslations({ locale, namespace: "join" }); const err = (k: string, field?: JoinField): JoinState => ({ error: t(k), field });
  const tierId = String(fd.get("tier") ?? ""); const tier = (await getTiers()).find((x) => x.id === tierId); if (!tier) return err("err_tier", "tier"); // offered (visible) tiers only
  const first = cleanText(fd.get("firstName"), limits.name), last = cleanText(fd.get("lastName"), limits.name); if (!first || !last) return err("err_name", first ? "ln" : "fn");
  const organisation = cleanText(fd.get("organisation"), limits.organisation); if (!organisation) return err("err_org", "org");
  const country = normCountry(fd.get("country")); if (!country) return err("err_country", "co"); // BUG-037: whitelist
  const needsSub = !!subdivisionsFor(country); // US → state/DC/territory, Canada → province
  const province = needsSub ? normProvince(fd.get("province"), country) : null; if (needsSub && !province) return err(country === "United States" ? "err_state" : "err_province", "pr");
  const institution = cleanText(fd.get("institution"), limits.institution);
  if (tier.requiresVerification && (fd.get("eligibilityAttest") !== "on" || !institution)) return err("err_student", institution ? "attest" : "inst");
  const session = await auth();
  // Q4 (round 7): Admin Portal accounts can't apply (their application would be invisible in Members, which excludes admins).
  if (session?.user?.role === "admin") return err("err_adminAccount");
  let userId = session?.user?.id; let newCreds: { email: string; password: string } | null = null;
  const profile = { name: `${first} ${last}`, organisation, country, province, directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on", locale };
  if (!userId) {
    const email = normEmail(fd.get("email")); const password = String(fd.get("password") ?? "");
    if (!emailOk(email)) return err("err_email", "em");
    const pwErr = checkPassword(password, email); if (pwErr) return err(`err_pw_${pwErr}`, "pw");
    if (!(await allowAccountCreation().catch(() => true))) return err("err_rate"); // S1-3 caps, checked before the bcrypt hash (a DB error here falls through to the handled create below)
    const hash = await bcrypt.hash(password, 10);
    try {
      if (await db.user.findUnique({ where: { email } })) return err("err_generic_account", "em"); // BUG-041: generic
      const u = await db.user.create({ data: { email, passwordHash: hash, role: "guest", ...profile } });
      userId = u.id; newCreds = { email, password };
    } catch (e) { // BUG-038 double submit; any other DB error → message instead of an error page (typed input is kept)
      if (isUniqueViolation(e)) return err("err_generic_account", "em");
      console.error("join: could not create account", e); return err("err_generic");
    }
  } else {
    // BUG-033: already a member (or an application in progress) → My membership
    await expireUnpaid(userId);
    const open = await db.membership.findMany({ where: { userId, status: { in: OPEN } } });
    if (open.some((o) => o.status !== "pending")) redirect(`/${locale}/my/billing?already=1`);
    // Legacy unpaid orders (from the old payment flow) are replaced by the application (cancelled first, conditionally)
    for (const o of open) await cancelUnpaid(o.id, userId, "membership.order_replaced");
    await db.user.update({ where: { id: userId }, data: profile });
  }
  let m;
  try { // activeSlot is unique: a second open membership for the same user fails here even under a race (BUG-033/038)
    m = await db.membership.create({ data: {
      userId, activeSlot: userId, tierId: tier.id, status: "pending_verification", currency: defaultCurrency, amountCents: 0, taxCents: 0, autoRenew: false,
      eligibilityNote: tier.requiresVerification ? `Attested student at: ${institution}` : null,
    } });
  } catch (e) {
    if (isUniqueViolation(e)) redirect(`/${locale}/my/billing?already=1`);
    console.error("join: could not save application", e);
    // An account created a moment ago without its application would block a retry ("account exists"): remove it.
    if (newCreds) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    return err("err_generic");
  }
  await db.auditLog.create({ data: { actor: userId, action: "membership.application_submitted", target: m.id } }).catch((e) => console.error("join: audit row failed", e));
  // Emails after the commit, sent after the response (Next `after()`): join.ack to the applicant, join.notify to the ADAIG inbox
  // (src/lib/notify/membership.ts; never throws, a failed send is logged in EmailLog and the application stands). In the
  // background so a slow/unreachable SMTP server never delays the applicant's redirect.
  const notice = {
    membershipId: m.id, createdAt: m.createdAt, userId, email: newCreds?.email, isNewAccount: !!newCreds,
    tierName: tier.name.en, requiresVerification: !!tier.requiresVerification,
    first, last, organisation, country, province, institution: institution || null,
  };
  after(() => notifyApplication(notice));

  const next = `/${locale}/my/billing?applied=1`; // My membership (member home) shows "Application received… your POC will be in touch"
  if (newCreds) await signIn("credentials", { ...newCreds, redirectTo: next });
  redirect(next);
}

/** BUG-042: cancel my unpaid (legacy) order (from /join or My membership). */
export async function cancelOrder(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const id = idParam(fd.get("m")); const back = fd.get("from") === "join" ? "join" : "my/billing";
  const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const ok = await cancelUnpaid(id, s.user.id);
  redirect(`/${locale}/${back}?msg=${ok ? "orderCancelled" : "orderNotFound"}`);
}
