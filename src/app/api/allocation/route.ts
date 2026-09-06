import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { deleteMyAllocationRule, getMyAllocationRules, upsertMyAllocationRule } from "@/lib/my-port";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Allocation lanes on their own, without touching the holding behind them.
 *
 * The holding editor writes categories through /api/portfolio/my-port because
 * it saves a quantity at the same time. This route covers the cases that have
 * no holding: moving a symbol between lanes, and the CASH pseudo-symbol, which
 * carries a literal balance rather than a market-priced position.
 */

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const allocationRules = await getMyAllocationRules();
  return NextResponse.json({ allocationRules }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }

  const symbol = readStringField(body, "symbol");
  const category = readStringField(body, "category");
  const rawCashValue = readNumberField(body, "cashValue");
  const cashCurrency = readStringField(body, "cashCurrency");

  if (!symbol) return errorResponse("Symbol is required");
  if (!category) return errorResponse("Category is required");
  if (rawCashValue !== undefined && (!Number.isFinite(rawCashValue) || rawCashValue < 0)) {
    return errorResponse("Cash value must be zero or more");
  }

  try {
    const allocationRules = await upsertMyAllocationRule({
      category,
      symbol,
      cashValue: rawCashValue,
      cashCurrency
    });

    return NextResponse.json(
      { symbol, category, allocationRules },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unable to update the allocation",
      500
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const body = await readOptionalJson(request);
  const symbol =
    readStringField(body, "symbol") ||
    request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ||
    "";

  if (!symbol) return errorResponse("Symbol is required");

  try {
    const allocationRules = await deleteMyAllocationRule(symbol);
    return NextResponse.json(
      { symbol, allocationRules },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unable to update the allocation",
      500
    );
  }
}

async function readOptionalJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readStringField(body: unknown, field: string) {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function readNumberField(body: unknown, field: string) {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[field];
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
