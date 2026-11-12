import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { serverEnv } from "@/lib/env";
import { activateMembership, confirmRegistration } from "@/lib/membership";
import { notifyEventRegistered } from "@/lib/notify/events";
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  const sig = req.headers.get("stripe-signature") ?? "";
  let evt;
  try { evt = stripe.webhooks.constructEvent(await req.text(), sig, secret); }
  catch { return NextResponse.json({ error: "bad signature" }, { status: 400 }); }
  // Only a PAID session confirms anything ("completed" can also mean an async payment that is still unpaid).
  const session = evt.data.object as { id?: string; payment_status?: string; metadata?: { membershipId?: string; registrationId?: string } };
  if (evt.type === "checkout.session.completed" && session.payment_status === "paid") {
    const md = session.metadata;
    if (md?.membershipId) await activateMembership(md.membershipId, "stripe-webhook");
    if (md?.registrationId) {
      const r = await confirmRegistration(md.registrationId, "stripe-webhook");
      // event.registered: same key as the Stripe return page (the Checkout session id), so one email for both (never throws).
      if (r?.status === "confirmed") await notifyEventRegistered({ registrationId: r.id, occurrence: session.id ?? r.paymentRef ?? "stripe" });
    }
  }
  return NextResponse.json({ received: true });
}
