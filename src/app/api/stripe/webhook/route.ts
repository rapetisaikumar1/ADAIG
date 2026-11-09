import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { activateMembership, confirmRegistration } from "@/lib/membership";
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  const sig = req.headers.get("stripe-signature") ?? "";
  let evt;
  try { evt = stripe.webhooks.constructEvent(await req.text(), sig, secret); }
  catch { return NextResponse.json({ error: "bad signature" }, { status: 400 }); }
  if (evt.type === "checkout.session.completed") {
    const md = (evt.data.object as { metadata?: { membershipId?: string; registrationId?: string } }).metadata;
    if (md?.membershipId) await activateMembership(md.membershipId, "stripe-webhook");
    if (md?.registrationId) await confirmRegistration(md.registrationId, "stripe-webhook");
  }
  return NextResponse.json({ received: true });
}
