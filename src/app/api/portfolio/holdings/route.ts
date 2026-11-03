import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { getHoldings } from "@/lib/portfolio-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open positions as stored -- quantity, cost basis, average cost, allocation
 * lane, how many trades back them -- plus cash. No market prices, so it
 * answers instantly; /api/portfolio/summary prices the same list.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    return NextResponse.json(await getHoldings(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read holdings" },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
