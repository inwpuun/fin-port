import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { fetchMarketData } from "@/lib/market";
import {
  createPortfolioSeedFromHoldingValue,
  createPortfolioSeedFromQuantity,
  deleteMyAllocationRule,
  deleteMyPortfolioSeed,
  getMyAllocationRules,
  upsertMyAllocationRule,
  upsertMyPortfolioSeed
} from "@/lib/my-port";
import type { MarketData } from "@/types/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // proxy.ts deliberately lets /api/* through so the CLI can use a bearer
  // token, so every writing route checks for itself.
  if (!(await isAuthorized(request))) return unauthorized();

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }

  const stock = readStringField(body, "stock");
  // readStringField uppercases, which is right for a ticker and wrong for a
  // category name -- "Software" and "SOFTWARE" would become two lanes.
  const category = readRawStringField(body, "category");
  if (!stock) return errorResponse("Stock is required");

  // Two ways to describe a position. Quantity + buy price is exact and needs
  // no quote, so it is tried first; holding value + % profit has to be priced
  // against the market to be turned into a quantity.
  const quantity = readNumberField(body, "quantity");
  const buyPrice = readNumberField(body, "buyPrice");
  const usesQuantity = Number.isFinite(quantity) || Number.isFinite(buyPrice);

  let seed;
  let market: MarketData | null = null;

  if (usesQuantity) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return errorResponse("Quantity must be greater than zero");
    }
    if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
      return errorResponse("Buy price must be greater than zero");
    }

    try {
      seed = createPortfolioSeedFromQuantity({
        stock,
        quantity,
        buyPrice,
        costCurrency: readStringField(body, "costCurrency") || "USD"
      });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "Invalid holding");
    }

    // Best effort only: the position is already fully described without it, so
    // a provider outage must not block the save.
    market = await fetchMarketData(stock, "1y", "1d", "1y").catch(() => null);
  } else {
    const holdingValue = readNumberField(body, "holdingValue");
    const profitPercent = readNumberField(body, "profitPercent");

    if (!Number.isFinite(holdingValue) || holdingValue <= 0) {
      return errorResponse("Holding value must be greater than zero");
    }
    if (!Number.isFinite(profitPercent) || profitPercent <= -100) {
      return errorResponse("% profit must be greater than -100");
    }

    try {
      market = await fetchMarketData(stock, "1y", "1d", "1y");
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "Unable to fetch market data", 502);
    }

    if (market.currency !== "USD") {
      return errorResponse(
        `Holding value entry needs a USD quote. ${market.symbol} returned ${market.currency}. Enter quantity and buy price instead.`
      );
    }

    try {
      seed = createPortfolioSeedFromHoldingValue({
        stock,
        holdingValue,
        profitPercent,
        marketPrice: market.price
      });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "Invalid holding");
    }
  }

  try {
    const portfolio = await upsertMyPortfolioSeed(seed);
    const allocationRules = category
      ? await upsertMyAllocationRule({ category, symbol: seed.symbol })
      : await getMyAllocationRules();

    return NextResponse.json(
      {
        seed,
        portfolio,
        allocationRules,
        market
      },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update the portfolio", 500);
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const body = await readOptionalJson(request);
  const stock = readStringField(body, "stock") || request.nextUrl.searchParams.get("stock")?.trim().toUpperCase() || "";

  if (!stock) return errorResponse("Stock is required");

  try {
    const portfolio = await deleteMyPortfolioSeed(stock);
    // Otherwise the symbol lingers in its allocation lane as a "missing"
    // position with no value behind it.
    const allocationRules = await deleteMyAllocationRule(stock);

    return NextResponse.json(
      {
        stock,
        portfolio,
        allocationRules
      },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update the portfolio", 500);
  }
}

async function readOptionalJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function readStringField(body: unknown, field: string) {
  if (!isRecord(body)) return "";
  const value = body[field];
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Same as readStringField but preserves the caller's capitalization. */
function readRawStringField(body: unknown, field: string) {
  if (!isRecord(body)) return "";
  const value = body[field];
  return typeof value === "string" ? value.trim() : "";
}

function readNumberField(body: unknown, field: string) {
  if (!isRecord(body)) return Number.NaN;
  const value = body[field];

  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
