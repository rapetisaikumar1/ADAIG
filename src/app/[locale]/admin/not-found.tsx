import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import PublicNotFound from "../not-found";
import { AdminNotFoundView } from "./_components/AdminNotFoundView";

/**
 * 404 for notFound() inside /admin/* (unknown /admin/<page>, a deleted member or event…). Signed-in admins stay inside the admin
 * portal (header/footer come from AreaChrome) with a designed empty state and one way back to their admin home; everyone else gets the
 * site's public 404 (the admin pages themselves still run their permission guard first).
 */
export default async function AdminNotFound() {
  if ((await auth())?.user?.role !== "admin") return <PublicNotFound />;
  return <AdminNotFoundView locale={await getLocale()} />;
}
