import { NextResponse } from "next/server";
/**
 * Uptime check (no auth, no secrets, never cached): { ok, db: "up" | "down" }. 200 when the database answers a ping
 * within 3 s, otherwise 503. The DB client is imported lazily so a configuration error still yields a clean "down".
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let up = false;
  try {
    const { db } = await import("@/lib/db");
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 3 s")), 3000)),
    ]);
    up = true;
  } catch (e) {
    const err = e as { message?: string; code?: string; name?: string };
    console.error("[health] database ping failed:", err?.message || err?.code || err?.name || String(e));
  }
  return NextResponse.json({ ok: up, db: up ? "up" : "down" }, { status: up ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } });
}
