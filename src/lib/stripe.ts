import Stripe from "stripe";
import { headers } from "next/headers";
import { serverEnv } from "@/lib/env";
/**
 * Payments (QA BUG-024 + R3). Stripe TEST mode only; payments fail closed.
 * - sk_test_ key: real Stripe test checkout.
 * - Live or unknown key: always rejected, with no mock fallback.
 * - No key: the mock checkout is allowed only in a local environment:
 *     NODE_ENV or APP_ENV is "development"/"local", OR
 *     ALLOW_MOCK_PAYMENTS=true AND both APP_URL and the request Host are localhost/127.0.0.1.
 *   ALLOW_MOCK_PAYMENTS is ignored everywhere else.
 */
const LOCAL_ENVS = ["development", "local"];
const isLocalHost = (h: string | null | undefined) => !!h && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h.trim());

export function stripeKeyState(): "test" | "none" | "rejected" {
  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) return "none";
  return key.startsWith("sk_test_") ? "test" : "rejected";
}
export function getStripe(): Stripe | null {
  return stripeKeyState() === "test" ? new Stripe(serverEnv().STRIPE_SECRET_KEY!) : null;
}
export async function mockAllowed(): Promise<boolean> {
  if (stripeKeyState() !== "none") return false;
  const env = serverEnv();
  if (LOCAL_ENVS.includes(process.env.NODE_ENV ?? "") || LOCAL_ENVS.includes(env.APP_ENV ?? "")) return true;
  if (env.ALLOW_MOCK_PAYMENTS !== "true") return false;
  let appHost: string | null = null;
  try { appHost = new URL(env.APP_URL ?? "").host; } catch { /* unset or invalid → not local */ }
  const reqHost = (await headers()).get("host");
  return isLocalHost(appHost) && isLocalHost(reqHost);
}
/** True when no payment method is usable. Details go to the server log only; visitors see a generic message. */
export async function paymentsUnavailable(): Promise<boolean> {
  const s = stripeKeyState();
  if (s === "test") return false;
  if (s === "none" && (await mockAllowed())) return false;
  console.error(s === "rejected"
    ? "[payments] Disabled: STRIPE_SECRET_KEY is not a Stripe test key (sk_test_…); live keys are refused in this build."
    : "[payments] Disabled: no STRIPE_SECRET_KEY, and the mock checkout is only allowed locally (APP_ENV/NODE_ENV development|local, or ALLOW_MOCK_PAYMENTS=true on localhost).");
  return true;
}

/**
 * Stripe Checkout sessions may live from 30 minutes to 24 hours. Ticket sessions use just under the maximum, so a Checkout
 * page left open can't be paid long after the visitor gave up (a late payment on a closed order is flagged, never lost).
 */
const CHECKOUT_TTL_S = 24 * 3600 - 300;
/** `expires_at` (Unix seconds) for stripe.checkout.sessions.create. */
const checkoutExpiresAt = (now = Date.now()) => Math.floor(now / 1000) + CHECKOUT_TTL_S;

/**
 * Create a Checkout session with `expires_at` set (unless the caller passes one). On any Stripe error (outage, bad key,
 * invalid parameters) the error is logged as "[stripe] …" and null is returned, so the caller can redirect with a friendly
 * payment error instead of a 500 page.
 */
export async function createCheckoutSession(stripe: Stripe, params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session | null> {
  try {
    return await stripe.checkout.sessions.create({ expires_at: checkoutExpiresAt(), ...params });
  } catch (e) {
    console.error("[stripe] checkout session create failed:", (e as Error)?.message ?? String(e));
    return null;
  }
}
