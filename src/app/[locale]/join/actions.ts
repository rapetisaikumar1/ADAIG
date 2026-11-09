"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auth, signIn } from "@/auth";
import { getStripe } from "@/lib/stripe";
import { expireUnpaid, cancelUnpaid, activateMembership } from "@/lib/membership";
import { getTier, subdivisionsFor, defaultCurrency } from "@/config/site";
import { getTranslations } from "next-intl/server";
import { checkPassword, emailOk, normEmail, cleanText, normCountry, normProvince, limits, isUniqueViolation, safeLocale } from "@/lib/validation";

export type JoinState = { error?: string };
const OPEN = ["pending", "pending_verification", "active"]; // statuses that block a new join (BUG-033)

/**
 * Membership application (data capture only, no payment). Creates the account if needed and a membership in
 * status "pending_verification" for ANY tier; staff approve or reject it in Admin → Members, and the ADAIG team
 * point of contact follows up with the applicant. Nothing is charged here: amount/tax are 0 and there is no paymentRef,
 * so a rejection never flags a refund and the application never shows up in dues totals.
 */
export async function startJoin(_: JoinState, fd: FormData): Promise<JoinState> {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const t = await getTranslations({ locale, namespace: "join" }); const err = (k: string) => ({ error: t(k) });
  const tier = getTier(String(fd.get("tier") ?? "")); if (!tier) return err("err_tier");
  const first = cleanText(fd.get("firstName"), limits.name), last = cleanText(fd.get("lastName"), limits.name); if (!first || !last) return err("err_name");
  const organisation = cleanText(fd.get("organisation"), limits.organisation); if (!organisation) return err("err_org");
  const country = normCountry(fd.get("country")); if (!country) return err("err_country"); // BUG-037: whitelist
  const needsSub = !!subdivisionsFor(country); // US → state/DC/territory, Canada → province
  const province = needsSub ? normProvince(fd.get("province"), country) : null; if (needsSub && !province) return err(country === "United States" ? "err_state" : "err_province");
  const institution = cleanText(fd.get("institution"), limits.institution);
  if (tier.requiresVerification && (fd.get("eligibilityAttest") !== "on" || !institution)) return err("err_student");
  const session = await auth();
  let userId = session?.user?.id; let newCreds: { email: string; password: string } | null = null;
  const profile = { name: `${first} ${last}`, organisation, country, province, directoryOptIn: fd.get("directoryOptIn") === "on", marketingOptIn: fd.get("marketingOptIn") === "on", locale };
  if (!userId) {
    const email = normEmail(fd.get("email")); const password = String(fd.get("password") ?? "");
    if (!emailOk(email)) return err("err_email");
    const pwErr = checkPassword(password, email); if (pwErr) return err(`err_pw_${pwErr}`);
    const hash = await bcrypt.hash(password, 10);
    try {
      if (await db.user.findUnique({ where: { email } })) return err("err_generic_account"); // BUG-041: generic
      const u = await db.user.create({ data: { email, passwordHash: hash, role: "guest", ...profile } });
      userId = u.id; newCreds = { email, password };
    } catch (e) { if (isUniqueViolation(e)) return err("err_generic_account"); throw e; } // BUG-038 double submit
  } else {
    // BUG-033: already a member (or an application in progress) → dashboard
    await expireUnpaid(userId);
    const open = await db.membership.findMany({ where: { userId, status: { in: OPEN } } });
    if (open.some((o) => o.status !== "pending")) redirect(`/${locale}/my/dashboard?already=1`);
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
  } catch (e) { if (isUniqueViolation(e)) redirect(`/${locale}/my/dashboard?already=1`); throw e; }
  await db.auditLog.create({ data: { actor: userId, action: "membership.application_submitted", target: m.id } });

  const next = `/${locale}/my/dashboard?applied=1`;
  if (newCreds) await signIn("credentials", { ...newCreds, redirectTo: next });
  redirect(next);
}

/** BUG-042: cancel my unpaid (legacy) order (from /join or the dashboard). */
export async function cancelOrder(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const id = String(fd.get("m") ?? ""); const back = fd.get("from") === "join" ? "join" : "my/dashboard";
  const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const ok = await cancelUnpaid(id, s.user.id);
  redirect(`/${locale}/${back}?msg=${ok ? "orderCancelled" : "orderNotFound"}`);
}

/** Legacy: a Stripe Checkout session started before the application flow returns here; verified server-side. */
export async function confirmStripe(id: string, sid: string) {
  const stripe = getStripe(); if (!stripe) return false;
  try {
    const cs = await stripe.checkout.sessions.retrieve(sid);
    if (cs.payment_status === "paid" && cs.metadata?.membershipId === id) { await activateMembership(id, "stripe-return"); return true; }
  } catch (e) { console.error("[stripe] confirm membership failed", (e as Error).message); } // bad/replayed sid → treat as unpaid
  return false;
}
