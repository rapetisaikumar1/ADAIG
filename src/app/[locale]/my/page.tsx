import { redirect } from "next/navigation";
import { MEMBER_HOME } from "@/lib/session";

/** Bare /<locale>/my → My membership (the member home); that page runs requireUser. */
export default async function MyIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}${MEMBER_HOME}`);
}
