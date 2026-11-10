import { getStripe } from "@/lib/stripe";
import { activateMembership, confirmRegistration } from "@/lib/membership";
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
    if (cs.payment_status === "paid" && cs.metadata?.registrationId === id) { await confirmRegistration(id, "stripe-return"); return true; }
  } catch (e) { console.error("[stripe] confirm ticket failed", (e as Error).message); }
  return false;
}
