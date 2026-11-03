import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { buildPortfolioSummary, parseSymbols } from "@/lib/portfolio-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The portfolio priced at the last close: per-holding value, P/L, day change,
 * weight, drawdown and signal, and totals with cash and net worth.
 *
 *   ?currency=THB (default) | USD   every money field except price/averageCost
 *   ?symbols=NVDA,BTC               only these holdings; totals then leave cash out
 *
 * A symbol that cannot be priced is listed in `errors` and left out of the
 * totals rather than failing the request.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const raw = (request.nextUrl.searchParams.get("currency") || "THB").trim().toUpperCase();
  if (raw !== "THB" && raw !== "USD") {
    return NextResponse.json({ error: "currency must be THB or USD" }, { status: 400 });
  }

  try {
    const summary = await buildPortfolioSummary({
      currency: raw,
      symbols: parseSymbols(request.nextUrl.searchParams.get("symbols"))
    });
    return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to build the summary" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}
