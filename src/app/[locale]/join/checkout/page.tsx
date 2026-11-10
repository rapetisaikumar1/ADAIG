import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { type Locale } from "@/config/site";
import { idParam } from "@/lib/validation";
import { confirmStripe } from "@/lib/stripeReturn";

/**
 * Legacy route. Joining is now an application (no payment step), so this page only finishes a Stripe Checkout
 * session that was started before the change (success_url points here), then sends everyone to the dashboard,
 * where any old unpaid order can be cancelled.
 */
export default async function Checkout({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ m?: string | string[]; sid?: string | string[] }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const sp = await searchParams; const id = idParam(sp.m), sid = idParam(sp.sid, 255); // invalid → "order not found" / unpaid
  const s = await auth(); if (!s?.user) redirect(`/${locale}/login`);
  const m = id ? await db.membership.findUnique({ where: { id } }) : null;
  if (!m || m.userId !== s.user.id) redirect(`/${locale}/my/dashboard?msg=orderNotFound`);
  if (m.status === "pending" && sid && (await confirmStripe(m.id, sid))) redirect(`/${locale}/my/dashboard?welcome=1`);
  redirect(`/${locale}/my/dashboard${m.status === "cancelled" || m.status === "expired" ? "?msg=orderClosed" : ""}`);
}
