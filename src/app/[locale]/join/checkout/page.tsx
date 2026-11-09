import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { type Locale } from "@/config/site";
import { confirmStripe } from "../actions";

/**
 * Legacy route. Joining is now an application (no payment step), so this page only finishes a Stripe Checkout
 * session that was started before the change (success_url points here), then sends everyone to the dashboard,
 * where any old unpaid order can be cancelled.
 */
export default async function Checkout({ params, searchParams }: { params: Promise<{ locale: Locale }>; searchParams: Promise<{ m?: string; sid?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const { m: id, sid } = await searchParams;
  const s = await auth(); if (!s?.user) redirect(`/${locale}/login`);
  const m = id ? await db.membership.findUnique({ where: { id } }) : null;
  if (!m || m.userId !== s.user.id) redirect(`/${locale}/my/dashboard?msg=orderNotFound`);
  if (m.status === "pending" && sid && (await confirmStripe(m.id, sid))) redirect(`/${locale}/my/dashboard?welcome=1`);
  redirect(`/${locale}/my/dashboard${m.status === "cancelled" || m.status === "expired" ? "?msg=orderClosed" : ""}`);
}
