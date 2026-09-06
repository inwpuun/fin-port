import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { fetchMarketData, normalizeDrawdownRange } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Carries no private data, but an open proxy on your deployment is still
  // someone else's free Yahoo quota. Everything behind the gate, no exceptions.
  if (!(await isAuthorized(request))) return unauthorized();

  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const range = request.nextUrl.searchParams.get("range") || "6mo";
  const interval = request.nextUrl.searchParams.get("interval") || "1d";
  const drawdownRange = normalizeDrawdownRange(request.nextUrl.searchParams.get("drawdownRange"));

  try {
    const data = await fetchMarketData(symbol, range, interval, drawdownRange);
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
