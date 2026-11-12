import { after } from "next/server";
import { getStripe } from "@/lib/stripe";
import { activateMembership, confirmRegistration } from "@/lib/membership";
import { notifyEventRegistered } from "@/lib/notify/events";
/**
 * Stripe Checkout return pages (server only): verify the session with Stripe before confirming anything.
 * Kept out of the "use server" action modules on purpose, so these are plain server functions called by the checkout
 * pages and never public Server Action endpoints.
 */

/** Legacy: a membership Checkout session started before the application flow returns to /join/checkout. */
export async function confirmStripe(id: string, sid: string) {
  const stripe = getStripe(); if (!stripe) return false;
  try {
    const cs = await stripe.checkout.sessions.retrieve(sid);
    if (cs.payment_status === "paid" && cs.metadata?.membershipId === id) { await activateMembership(id, "stripe-return"); return true; }
  } catch (e) { console.error("[stripe] confirm membership failed", (e as Error).message); } // bad/replayed sid → treat as unpaid
  return false;
}

/** Event ticket: /events/[slug]/checkout?r=…&sid=… after Stripe Checkout. */
export async function confirmStripeTicket(id: string, sid: string) {
  const stripe = getStripe(); if (!stripe) return false;
  try {
    const cs = await stripe.checkout.sessions.retrieve(sid);
    if (cs.payment_status === "paid" && cs.metadata?.registrationId === id) {
      const r = await confirmRegistration(id, "stripe-return");
      // event.registered after the response (called from the checkout page, a server component). The key is the Checkout
      // session id, shared with the webhook, so the return page (or a reload) and the webhook send one email together.
      if (r?.status === "confirmed") after(() => notifyEventRegistered({ registrationId: id, occurrence: cs.id }));
      return true;
    }
  } catch (e) { console.error("[stripe] confirm ticket failed", (e as Error).message); }
  return false;
}
