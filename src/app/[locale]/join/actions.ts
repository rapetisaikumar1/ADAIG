"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auth, signIn } from "@/auth";
import { getStripe, mockAllowed } from "@/lib/stripe";
import { expireUnpaid, cancelUnpaid, activateMembership } from "@/lib/membership";
import { getTier, currencies, subdivisionsFor, taxFor, unpaidOrderTtlHours, type Currency } from "@/config/site";
import { getTranslations } from "next-intl/server";
import { checkPassword, emailOk, normEmail, cleanText, normCountry, normProvince, limits, isUniqueViolation, safeLocale } from "@/lib/validation";

export type JoinState = { error?: string };
const OPEN = ["pending", "pending_verification", "active"]; // statuses that block a new join (BUG-033)

export async function startJoin(_: JoinState, fd: FormData): Promise<JoinState> {
  const locale = fd.get("locale") === "fr" ? "fr" : "en";
  const t = await getTranslations({ locale, namespace: "join" }); const err = (k: string) => ({ error: t(k) });
  const tier = getTier(String(fd.get("tier") ?? "")); if (!tier) return err("err_tier");
  const currency = String(fd.get("currency") ?? ""); if (!(currencies as readonly string[]).includes(currency)) return err("err_required");
  const first = cleanText(fd.get("firstName"), limits.name), last = cleanText(fd.get("lastName"), limits.name); if (!first || !last) return err("err_name");
  const organisation = cleanText(fd.get("organisation"), limits.organisation); if (!organisation) return err("err_org");
  const country = normCountry(fd.get("country")); if (!country) return err("err_country"); // BUG-037: whitelist, tax decided from this value only
  const needsSub = !!subdivisionsFor(country); // US → state/DC/territory, Canada → province (no tax)
  const province = needsSub ? normProvince(fd.get("province"), country) : null; if (needsSub && !province) return err(country === "United States" ? "err_state" : "err_province");
  const institution = cleanText(fd.get("institution"), limits.institution);
  if (tier.requiresVerification && (fd.get("eligibilityAttest") !== "on" || !institution)) return err("err_student");
  const d = { locale, currency: currency as Currency, autoRenew: fd.get("autoRenew") === "on" };
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
    // BUG-033: already a member (or an application/payment in progress) → dashboard
    await expireUnpaid(userId);
    const open = await db.membership.findMany({ where: { userId, status: { in: OPEN } } });
    if (open.some((o) => o.status !== "pending")) redirect(`/${locale}/my/dashboard?already=1`);
    // BUG-042: choosing a tier/currency while an order is unpaid replaces it (the old one is cancelled first, conditionally)
    for (const o of open) await cancelUnpaid(o.id, userId, "membership.order_replaced");
    await db.user.update({ where: { id: userId }, data: profile });
  }
  const amount = tier.price[d.currency as Currency]; const tax = taxFor(country, province, amount);
  let m;
  try { // activeSlot is unique: a second open membership for the same user fails here even under a race (BUG-033/038)
    m = await db.membership.create({ data: { userId, activeSlot: userId, tierId: tier.id, currency: d.currency, amountCents: amount, taxCents: tax.amount, autoRenew: d.autoRenew, eligibilityNote: tier.requiresVerification ? `Attested student at: ${institution}` : null } });
  } catch (e) { if (isUniqueViolation(e)) redirect(`/${locale}/my/dashboard?already=1`); throw e; }
  await db.auditLog.create({ data: { actor: userId, action: "membership.checkout_started", target: m.id } });

  let next = `/${d.locale}/join/checkout?m=${m.id}`; // mock checkout
  const stripe = getStripe();
  if (stripe) {
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const cs = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        { quantity: 1, price_data: { currency: d.currency.toLowerCase(), unit_amount: amount, product_data: { name: `ADAIG ${tier.name.en} membership (1 yr)` } } },
        ...(tax.amount ? [{ quantity: 1, price_data: { currency: d.currency.toLowerCase(), unit_amount: tax.amount, product_data: { name: `Sales tax (${tax.label})` } } }] : []),
      ],
      metadata: { membershipId: m.id },
      // Stripe sessions live 30 min–24 h; keep the session no longer than our unpaid-order TTL (BUG-042)
      expires_at: Math.floor(Date.now() / 1000) + Math.round(Math.min(24, Math.max(0.5, unpaidOrderTtlHours())) * 3600) - 60,
      success_url: `${base}/${d.locale}/join/checkout?m=${m.id}&stripe=success&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/${d.locale}/join?tier=${tier.id}&cur=${d.currency}`,
    });
    await db.membership.update({ where: { id: m.id }, data: { paymentRef: cs.id } });
    next = cs.url!;
  }
  if (newCreds) await signIn("credentials", { ...newCreds, redirectTo: next });
  redirect(next);
}

/** BUG-042: cancel my unpaid order (from /join or the dashboard). */
export async function cancelOrder(fd: FormData) {
  const locale = safeLocale(fd.get("locale")); const id = String(fd.get("m") ?? ""); const back = fd.get("from") === "join" ? "join" : "my/dashboard";
  const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  const ok = await cancelUnpaid(id, s.user.id);
  redirect(`/${locale}/${back}?msg=${ok ? "orderCancelled" : "orderNotFound"}`);
}

export async function completeMockPayment(fd: FormData) {
  const id = String(fd.get("m") ?? ""); const locale = safeLocale(fd.get("locale"));
  const s = await auth(); if (!s?.user?.id) redirect(`/${locale}/login`);
  await expireUnpaid(s.user.id);
  const m = await db.membership.findUnique({ where: { id } });
  // replay against someone else's / unknown / closed order → friendly notice, never a 500 or a payment
  if (!m || m.userId !== s.user.id) redirect(`/${locale}/my/dashboard?msg=orderNotFound`);
  if (m.status === "pending" && !(currencies as readonly string[]).includes(m.currency)) redirect(`/${locale}/my/dashboard?msg=orderClosed`); // currency no longer offered
  if (m.status !== "pending") redirect(`/${locale}/my/dashboard?msg=${m.status === "active" || m.status === "pending_verification" ? "alreadyPaid" : "orderClosed"}`);
  if (!(await mockAllowed())) redirect(`/${locale}/join/checkout?m=${id}`); // Stripe in use or payments disabled: no mock bypass (BUG-024)
  await db.membership.updateMany({ where: { id, status: "pending" }, data: { paymentRef: `mock_${Date.now()}` } }); // idempotent on double click
  await activateMembership(id, s.user.id);
  redirect(`/${locale}/my/dashboard?welcome=1`);
}

export async function confirmStripe(id: string, sid: string) {
  const stripe = getStripe(); if (!stripe) return false;
  try {
    const cs = await stripe.checkout.sessions.retrieve(sid);
    if (cs.payment_status === "paid" && cs.metadata?.membershipId === id) { await activateMembership(id, "stripe-return"); return true; }
  } catch (e) { console.error("[stripe] confirm membership failed", (e as Error).message); } // bad/replayed sid → treat as unpaid
  return false;
}
