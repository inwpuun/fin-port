import { NextRequest, NextResponse } from "next/server";
import { deleteMyWatchlistSymbol, getMyWatchlistSymbols, upsertMyWatchlistSymbol } from "@/lib/my-watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const symbols = await getMyWatchlistSymbols();

  return NextResponse.json(
    { symbols },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}

export async function POST(request: NextRequest) {
  const body = await readOptionalJson(request);
  const symbol = readStringField(body, "symbol") || readStringField(body, "stock");

  if (!symbol) return errorResponse("Symbol is required");

  try {
    const symbols = await upsertMyWatchlistSymbol(symbol);

    return NextResponse.json(
      { symbol, symbols },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update my-watchlist.csv", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const body = await readOptionalJson(request);
  const symbol =
    readStringField(body, "symbol") ||
    readStringField(body, "stock") ||
    request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ||
    request.nextUrl.searchParams.get("stock")?.trim().toUpperCase() ||
    "";

  if (!symbol) return errorResponse("Symbol is required");

  try {
    const symbols = await deleteMyWatchlistSymbol(symbol);

    return NextResponse.json(
      { symbol, symbols },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update my-watchlist.csv", 500);
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
