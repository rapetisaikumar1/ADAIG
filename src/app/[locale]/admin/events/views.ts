import type { Prisma } from "@/generated/prisma/client";
import { likeLiteral } from "@/lib/validation";

/** Registration list filters on the event page (also used by the CSV export, so the export matches what staff see). */
export const REG_VIEWS = ["all", "confirmed", "attended", "absent", "pending", "cancelled"] as const;
export type RegView = (typeof REG_VIEWS)[number];
export const regView = (v: unknown): RegView => ((REG_VIEWS as readonly string[]).includes(String(v)) ? (v as RegView) : "all");
export const regViewWhere = (v: RegView): Prisma.RegistrationWhereInput =>
  v === "confirmed" ? { status: "confirmed" } : v === "attended" ? { status: "confirmed", attended: true } : v === "absent" ? { status: "confirmed", attended: false }
    : v === "pending" ? { status: "pending_payment" } : v === "cancelled" ? { status: "cancelled" } : {};
/** Case-insensitive search on name or email (ILIKE via Prisma `contains`, like the public events search). */
export const regSearchWhere = (q: string): Prisma.RegistrationWhereInput =>
  q ? { user: { OR: [{ name: { contains: likeLiteral(q), mode: "insensitive" } }, { email: { contains: likeLiteral(q), mode: "insensitive" } }] } } : {};
export const cleanQuery = (q: unknown) => String(q ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
