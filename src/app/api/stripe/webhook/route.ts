import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { serverEnv } from "@/lib/env";
import { activateMembership, confirmRegistration } from "@/lib/membership";
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  const sig = req.headers.get("stripe-signature") ?? "";
  let evt;
  try { evt = stripe.webhooks.constructEvent(await req.text(), sig, secret); }
  catch { return NextResponse.json({ error: "bad signature" }, { status: 400 }); }
  // Only a PAID session confirms anything ("completed" can also mean an async payment that is still unpaid).
  const session = evt.data.object as { payment_status?: string; metadata?: { membershipId?: string; registrationId?: string } };
  if (evt.type === "checkout.session.completed" && session.payment_status === "paid") {
    const md = session.metadata;
    if (md?.membershipId) await activateMembership(md.membershipId, "stripe-webhook");
    if (md?.registrationId) await confirmRegistration(md.registrationId, "stripe-webhook");
  }
  return NextResponse.json({ received: true });
}
