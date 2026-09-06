import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { fetchMarketData } from "@/lib/market";
import { createPortfolioSeedFromHoldingValue, deleteMyPortfolioSeed, upsertMyPortfolioSeed } from "@/lib/my-port";
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
  const holdingValue = readNumberField(body, "holdingValue");
  const profitPercent = readNumberField(body, "profitPercent");

  if (!stock) return errorResponse("Stock is required");
  if (!Number.isFinite(holdingValue) || holdingValue <= 0) {
    return errorResponse("Holding value must be greater than zero");
  }
  if (!Number.isFinite(profitPercent) || profitPercent <= -100) {
    return errorResponse("% profit must be greater than -100");
  }

  let market: MarketData;

  try {
    market = await fetchMarketData(stock, "1y", "1d", "1y");
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to fetch market data", 502);
  }

  if (market.currency !== "USD") {
    return errorResponse(`Only USD market data can be saved to my-port.csv. ${market.symbol} returned ${market.currency}.`);
  }

  try {
    const seed = createPortfolioSeedFromHoldingValue({
      stock,
      holdingValue,
      profitPercent,
      marketPrice: market.price
    });
    const portfolio = await upsertMyPortfolioSeed(seed);

    return NextResponse.json(
      {
        seed,
        portfolio,
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

    return NextResponse.json(
      {
        stock,
        portfolio
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
