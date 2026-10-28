import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { withTransaction } from "@/lib/db/client";
import {
  deleteMyAllocationRule,
  getMyAllocationRules,
  getMyCashBalances,
  getMyPortfolioSeed,
  getMyTransactions,
  upsertMyAllocationRule
} from "@/lib/my-port";
import { addTransaction, deleteTransaction, isPositionTrade, type TransactionWriteResult } from "@/lib/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const [transactions, cash] = await Promise.all([getMyTransactions(), getMyCashBalances()]);
  return NextResponse.json({ transactions, cash }, { headers: { "cache-control": "no-store" } });
}

/**
 * Records a buy, sell, deposit or withdrawal. A buy or sell rebuilds that
 * symbol's holdings row from its trades; a deposit or withdrawal moves the
 * cash balance in its currency.
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

  const category = typeof body.category === "string" ? body.category.trim() : "";

  let result: TransactionWriteResult;
  try {
    // One database transaction: a sell larger than the position throws during
    // the rebuild, and the trade it rejected must not stay behind.
    result = await withTransaction((client) =>
      addTransaction(client, {
        symbol: readString(body.symbol),
        side: readString(body.side),
        quantity: Number(body.quantity),
        price: Number(body.price),
        fee: body.fee === undefined || body.fee === "" ? 0 : Number(body.fee),
        currency: readString(body.currency),
        occurredOn: readString(body.occurredOn),
        note: readString(body.note) || null
      })
    );
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to record the transaction");
  }

  try {
    await syncAllocation(result, category);
    return NextResponse.json(await snapshot(result), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Saved, but the page could not be refreshed", 500);
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const id = request.nextUrl.searchParams.get("id")?.trim() || "";
  if (!id) return errorResponse("Transaction id is required");

  let result: TransactionWriteResult | null;
  try {
    result = await withTransaction((client) => deleteTransaction(client, id));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to delete the transaction");
  }

  if (!result) return errorResponse("Transaction not found", 404);

  try {
    await syncAllocation(result, "");
    return NextResponse.json(await snapshot(result), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Deleted, but the page could not be refreshed", 500);
  }
}

/**
 * A first buy files the symbol into the lane the form picked; a sell that
 * closes the position clears its lane, the same as Remove does, so the
 * allocation page does not keep a lane pointing at nothing.
 */
async function syncAllocation({ transaction, open }: TransactionWriteResult, category: string) {
  if (!isPositionTrade(transaction)) return;
  if (!open) await deleteMyAllocationRule(transaction.symbol);
  else if (category) await upsertMyAllocationRule({ category, symbol: transaction.symbol });
}

async function snapshot({ transaction }: TransactionWriteResult) {
  const [transactions, portfolio, allocationRules, cash] = await Promise.all([
    getMyTransactions(),
    getMyPortfolioSeed(),
    getMyAllocationRules(),
    getMyCashBalances()
  ]);
  return { transaction, transactions, portfolio, allocationRules, cash };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
