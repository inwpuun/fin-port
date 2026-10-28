import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { fetchLatestPrice, type LatestPrice } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A portfolio is a few dozen symbols; anything far past that is a mistake or abuse. */
const MAX_SYMBOLS = 60;

/**
 * Latest price for many symbols in one request:
 * `/api/market/prices?symbols=AAPL,GOLD,THB=X`.
 *
 * Keys in `prices` are the symbols as asked for, so a caller can look up what
 * it sent. A symbol Yahoo cannot price lands in `errors` instead of failing
 * the whole batch.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const symbols = [
    ...new Set(
      (request.nextUrl.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean)
    )
  ];

  if (!symbols.length) return NextResponse.json({ error: "symbols is required" }, { status: 400 });
  if (symbols.length > MAX_SYMBOLS) {
    return NextResponse.json({ error: `At most ${MAX_SYMBOLS} symbols per request` }, { status: 400 });
  }

  const results = await Promise.allSettled(symbols.map((symbol) => fetchLatestPrice(symbol)));
  const prices: Record<string, LatestPrice> = {};
  const errors: Record<string, string> = {};

  results.forEach((result, index) => {
    if (result.status === "fulfilled") prices[symbols[index]] = result.value;
    else errors[symbols[index]] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });

  return NextResponse.json({ prices, errors }, { headers: { "cache-control": "no-store" } });
}
