import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Allocation, Holding, WatchlistItem } from "@/types/portfolio";

type HoldingRow = {
  id: string;
  symbol: string;
  quantity: string | number;
  cost_basis: string | number;
  cost_currency: string;
};

/** Postgres numerics arrive as strings over PostgREST; normalize at the edge. */
function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toHolding(row: HoldingRow): Holding {
  const quantity = num(row.quantity);
  const costBasis = num(row.cost_basis);
  return {
    id: row.id,
    symbol: row.symbol,
    quantity,
    costBasis,
    costCurrency: row.cost_currency,
    buyPrice: quantity > 0 ? costBasis / quantity : 0
  };
}

export async function listHoldings(): Promise<Holding[]> {
  const { data, error } = await supabaseAdmin()
    .from("holdings")
    .select("id, symbol, quantity, cost_basis, cost_currency")
    .order("sort_order", { ascending: true })
    .order("symbol", { ascending: true });

  if (error) throw new Error(`listHoldings failed: ${error.message}`);
  return (data ?? []).map((row) => toHolding(row as HoldingRow));
}

export async function upsertHolding(input: {
  symbol: string;
  quantity: number;
  costBasis: number;
  costCurrency: string;
}): Promise<Holding> {
  const { data, error } = await supabaseAdmin()
    .from("holdings")
    .upsert(
      {
        symbol: input.symbol.trim().toUpperCase(),
        quantity: input.quantity,
        cost_basis: input.costBasis,
        cost_currency: input.costCurrency.trim().toUpperCase() || "USD"
      },
      { onConflict: "symbol" }
    )
    .select("id, symbol, quantity, cost_basis, cost_currency")
    .single();

  if (error) throw new Error(`upsertHolding failed: ${error.message}`);
  return toHolding(data as HoldingRow);
}

export async function deleteHolding(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("holdings").delete().eq("id", id);
  if (error) throw new Error(`deleteHolding failed: ${error.message}`);
}

export async function listAllocations(): Promise<Allocation[]> {
  const { data, error } = await supabaseAdmin()
    .from("allocations")
    .select("id, category, symbol, cash_value, cash_currency")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`listAllocations failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    category: row.category as string,
    symbol: row.symbol as string,
    cashValue: row.cash_value == null ? null : num(row.cash_value as string),
    cashCurrency: (row.cash_currency as string | null) ?? null
  }));
}

export async function listWatchlist(): Promise<WatchlistItem[]> {
  const { data, error } = await supabaseAdmin()
    .from("watchlist")
    .select("id, symbol, sort_order")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`listWatchlist failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    symbol: row.symbol as string,
    sortOrder: (row.sort_order as number) ?? 0
  }));
}

export async function addWatchlistSymbol(symbol: string): Promise<WatchlistItem> {
  const clean = symbol.trim().toUpperCase();
  const { data, error } = await supabaseAdmin()
    .from("watchlist")
    .upsert({ symbol: clean }, { onConflict: "symbol" })
    .select("id, symbol, sort_order")
    .single();

  if (error) throw new Error(`addWatchlistSymbol failed: ${error.message}`);
  return {
    id: data.id as string,
    symbol: data.symbol as string,
    sortOrder: (data.sort_order as number) ?? 0
  };
}

export async function removeWatchlistSymbol(symbol: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("watchlist")
    .delete()
    .eq("symbol", symbol.trim().toUpperCase());

  if (error) throw new Error(`removeWatchlistSymbol failed: ${error.message}`);
}
