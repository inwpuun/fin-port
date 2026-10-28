import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { withTransaction } from "@/lib/db/client";
import { getMyAllocationRules, getMyCashBalances, getMyTransactions, upsertMyAllocationRule } from "@/lib/my-port";
import { CASH_SYMBOL, normalizeDate, setCashBalances } from "@/lib/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sets the USD and THB balances to what the form says. The difference from
 * the current balance is recorded as a deposit or withdrawal on `occurredOn`,
 * so the net-worth history sees when money arrived.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") return errorResponse("Request body must be a JSON object");

  const usd = Number(body.usd);
  const thb = Number(body.thb);
  const category = typeof body.category === "string" ? body.category.trim() : "";

  if (!Number.isFinite(usd) || usd < 0) return errorResponse("USD balance must be zero or more");
  if (!Number.isFinite(thb) || thb < 0) return errorResponse("THB balance must be zero or more");

  try {
    const occurredOn = normalizeDate(typeof body.occurredOn === "string" ? body.occurredOn : "");
    await withTransaction((client) => setCashBalances(client, { USD: usd, THB: thb }, occurredOn));
    if (category) await upsertMyAllocationRule({ category, symbol: CASH_SYMBOL });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update cash");
  }

  const [transactions, allocationRules, cash] = await Promise.all([
    getMyTransactions(),
    getMyAllocationRules(),
    getMyCashBalances()
  ]);

  return NextResponse.json({ transactions, allocationRules, cash }, { headers: { "cache-control": "no-store" } });
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
