import { NextRequest } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { refreshCashBook } from "@/lib/cash-book/run-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reads the cash book from Firefly III now instead of waiting for the timer,
 * and rebuilds THB cash if it changed. Same run as the Refresh button.
 *
 *   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/cash-book/refresh
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    return Response.json({ ok: true, ...(await refreshCashBook()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Refresh failed" }, { status: 500 });
  }
}
