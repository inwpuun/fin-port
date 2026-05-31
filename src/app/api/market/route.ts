import { NextRequest, NextResponse } from "next/server";
import { fetchMarketData, normalizeDrawdownRange } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
