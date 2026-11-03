import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db/client";
import {
  deleteMyAllocationRule,
  getMyAllocationRules,
  getMyCashBalances,
  getMyPortfolioSeed,
  getMyTransactions,
  upsertMyAllocationRule
} from "@/lib/my-port";
import {
  addTransaction,
  deleteTransaction,
  getTransaction,
  isPositionTrade,
  listTransactions,
  normalizeDate,
  symbolKey,
  updateTransaction,
  type TransactionPatch,
  type TransactionUpdateResult,
  type TransactionWriteResult
} from "@/lib/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The trade log, newest first, and the cash balances.
 *
 *   ?id=<id>                one row ({ transaction }), 404 if it does not exist
 *   ?symbol=NVDA            one position, whatever spelling it was entered under (BRK.B = BRK-B)
 *   ?side=buy,sell          one or more of buy, sell, dividend, fee, deposit, withdraw
 *   ?from=2026-01-01&to=    occurred_on range, inclusive (YYYY-MM-DD or d/m/yy)
 *   ?limit=50               newest N after filtering
 *
 * Unlike the page loaders this reports a database error as a 500 instead of
 * an empty list, so an agent cannot mistake an outage for "no trades".
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const params = request.nextUrl.searchParams;

  try {
    const id = params.get("id")?.trim();
    if (id) {
      const transaction = await getTransaction(db(), id);
      return transaction ? json({ transaction }) : errorResponse("Transaction not found", 404);
    }

    const symbol = params.get("symbol")?.trim();
    const sides = (params.get("side") || "")
      .split(",")
      .map((side) => side.trim().toLowerCase())
      .filter(Boolean);
    const from = params.get("from")?.trim() ? normalizeDate(params.get("from")!) : null;
    const to = params.get("to")?.trim() ? normalizeDate(params.get("to")!) : null;
    const limit = params.get("limit") ? Number(params.get("limit")) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) return errorResponse("limit must be a positive integer");

    const key = symbol ? symbolKey(symbol) : null;
    let transactions = (await listTransactions(db()))
      .reverse()
      .filter((row) => !key || symbolKey(row.symbol) === key)
      .filter((row) => !sides.length || sides.includes(row.side))
      .filter((row) => (!from || row.occurredOn >= from) && (!to || row.occurredOn <= to));
    const total = transactions.length;
    if (limit) transactions = transactions.slice(0, limit);

    return json({ transactions, total, cash: await getMyCashBalances() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read transactions";
    // normalizeDate's messages are input errors; anything else is the database.
    return errorResponse(message, /date|future/i.test(message) ? 400 : 500);
  }
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

/**
 * Edits one transaction: `?id=` (or `id` in the body) plus any of symbol,
 * side, quantity, price, fee, currency, occurredOn, note. Fields left out keep
 * their value. The row gets a new id, returned as `transaction.id`.
 */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") return errorResponse("Request body must be a JSON object");

  const id = request.nextUrl.searchParams.get("id")?.trim() || readString(body.id);
  if (!id) return errorResponse("Transaction id is required");

  const patch: TransactionPatch = {};
  for (const field of ["symbol", "side", "currency", "occurredOn"] as const) {
    if (body[field] !== undefined) patch[field] = readString(body[field]);
  }
  for (const field of ["quantity", "price", "fee"] as const) {
    if (body[field] !== undefined && body[field] !== "") patch[field] = Number(body[field]);
  }
  if (body.note !== undefined) patch.note = body.note === null ? null : readString(body.note) || null;
  if (!Object.keys(patch).length) return errorResponse("Nothing to change");

  let result: TransactionUpdateResult | null;
  try {
    result = await withTransaction((client) => updateTransaction(client, id, patch));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update the transaction");
  }

  if (!result) return errorResponse("Transaction not found", 404);

  try {
    const category = typeof body.category === "string" ? body.category.trim() : "";
    await syncAllocation(result, category);
    if (isPositionTrade(result.previous) && !result.previousOpen) await deleteMyAllocationRule(result.previous.symbol);
    return json({ ...(await snapshot(result)), previous: result.previous });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Updated, but the page could not be refreshed", 500);
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

function json(payload: unknown) {
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
