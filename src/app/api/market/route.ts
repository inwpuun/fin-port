import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { fetchMarketData, normalizeDrawdownRange, normalizeRange } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Carries no private data, but an open proxy on your deployment is still
  // someone else's free Yahoo quota. Everything behind the gate, no exceptions.
  if (!(await isAuthorized(request))) return unauthorized();

  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  const interval = request.nextUrl.searchParams.get("interval") || "1d";
  const drawdownRange = normalizeDrawdownRange(request.nextUrl.searchParams.get("drawdownRange"));
  // Per-bar overlays are ~11 arrays over the whole window. A table wants the
  // scalars only, so a caller has to ask before paying for them.
  const overlays = request.nextUrl.searchParams.get("overlays") === "1";

  try {
    const data = await fetchMarketData(symbol, range, interval, drawdownRange, overlays);
    return NextResponse.json(data, {
      headers: {
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to fetch market data"
      },
      { status: 502 }
    );
  }
}
