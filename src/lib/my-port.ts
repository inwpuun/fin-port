import "server-only";
import { normalizeSymbol } from "@/lib/market";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { AllocationRule, PortfolioSeed } from "@/types/portfolio";

/**
 * Portfolio storage. The exported surface is unchanged from the CSV version,
 * so every page and route handler above it keeps working -- only the backing
 * store moved to Postgres.
 *
 * The CSV version wrote back to public/my-port.csv, which cannot work on
 * Vercel: the serverless filesystem is read-only, so every upsert and delete
 * would have failed in production. Docker Compose papered over it locally by
 * bind-mounting ./public. Postgres removes the constraint entirely.
 */

type PortfolioHoldingValueInput = {
  stock: string;
  holdingValue: number;
  profitPercent: number;
  marketPrice: number;
};

type HoldingRow = {
  symbol: string;
  quantity: string | number;
  cost_basis: string | number;
  cost_currency: string | null;
};

/** Postgres numerics arrive as strings over PostgREST. */
function num(value: string | number | null | undefined) {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToSeed(row: HoldingRow): PortfolioSeed {
  const symbol = row.symbol.trim().toUpperCase();
  return {
    id: createPortfolioSeedId(symbol),
    symbol,
    quantity: num(row.quantity),
    costBasis: num(row.cost_basis),
    costCurrency: (row.cost_currency || "USD").toUpperCase()
  };
}

export async function getMyPortfolioSeed(): Promise<PortfolioSeed[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("holdings")
      .select("symbol, quantity, cost_basis, cost_currency")
      .order("sort_order", { ascending: true })
      .order("symbol", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => rowToSeed(row as HoldingRow));
  } catch (error) {
    // Same contract as the CSV version: an unreachable store reads as empty so
    // the dashboard renders instead of throwing a 500. Log it, though -- a
    // silent empty table is otherwise indistinguishable from a real one.
    console.error("getMyPortfolioSeed failed:", error);
    return [];
  }
}

export async function getMyAllocationRules(): Promise<AllocationRule[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("allocations")
      .select("category, symbol, cash_value, cash_currency")
      .order("sort_order", { ascending: true })
      .order("category", { ascending: true })
      .order("symbol", { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => {
      const cashValue = row.cash_value == null ? undefined : num(row.cash_value as string);
      const cashCurrency = (row.cash_currency as string | null) || undefined;

      return {
        category: row.category as string,
        symbol: (row.symbol as string).toUpperCase(),
        ...(cashValue === undefined ? {} : { cashValue }),
        ...(cashCurrency ? { cashCurrency: cashCurrency.toUpperCase() } : {})
      };
    });
  } catch (error) {
    console.error("getMyAllocationRules failed:", error);
    return [];
  }
}

export type AllocationRuleInput = {
  category: string;
  symbol: string;
  cashValue?: number | null;
  cashCurrency?: string | null;
};

/**
 * Moves a symbol into a category, creating the lane if it is new.
 *
 * A symbol belongs to exactly one lane, but the table is keyed on
 * (category, symbol) -- so a move has to clear the symbol's other rows first,
 * or it would be counted in two categories at once and inflate the total.
 */
export async function upsertMyAllocationRule(rule: AllocationRuleInput): Promise<AllocationRule[]> {
  const symbol = rule.symbol.trim().toUpperCase();
  const category = rule.category.trim();

  if (!symbol) throw new Error("Symbol is required");
  if (!category) throw new Error("Category is required");

  const client = supabaseAdmin();

  const { error: clearError } = await client
    .from("allocations")
    .delete()
    .eq("symbol", symbol)
    .neq("category", category);
  if (clearError) throw new Error(`Could not move ${symbol}: ${clearError.message}`);

  const cashValue = Number.isFinite(Number(rule.cashValue)) ? Number(rule.cashValue) : null;
  const cashCurrency = (rule.cashCurrency || "").trim().toUpperCase() || null;

  const { error } = await client.from("allocations").upsert(
    {
      category,
      symbol,
      cash_value: cashValue,
      cash_currency: cashCurrency
    },
    { onConflict: "category,symbol" }
  );

  if (error) throw new Error(`Could not save ${symbol} allocation: ${error.message}`);
  return getMyAllocationRules();
}

/** Removes a symbol from every allocation lane. */
export async function deleteMyAllocationRule(symbol: string): Promise<AllocationRule[]> {
  const clean = symbol.trim().toUpperCase();
  if (!clean) throw new Error("Symbol is required");

  const { error } = await supabaseAdmin().from("allocations").delete().eq("symbol", clean);
  if (error) throw new Error(`Could not delete ${clean} allocation: ${error.message}`);

  return getMyAllocationRules();
}

export function createPortfolioSeedFromHoldingValue({
  stock,
  holdingValue,
  profitPercent,
  marketPrice
}: PortfolioHoldingValueInput): PortfolioSeed {
  const symbol = stock.trim().toUpperCase();
  const profitRatio = 1 + profitPercent / 100;

  if (!symbol) throw new Error("Stock is required");
  if (!Number.isFinite(holdingValue) || holdingValue <= 0) throw new Error("Holding value must be greater than zero");
  if (!Number.isFinite(profitPercent) || profitRatio <= 0) throw new Error("% profit must be greater than -100");
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) throw new Error("Market price must be greater than zero");

  return normalizeSeed({
    id: createPortfolioSeedId(symbol),
    symbol,
    quantity: holdingValue / marketPrice,
    costBasis: holdingValue / profitRatio,
    costCurrency: "USD"
  });
}

/**
 * Builds a seed from a quantity and a per-unit buy price, which is what the
 * holding editor collects. Unlike the holding-value form this needs no market
 * quote, so it also works for assets priced in a non-USD currency.
 */
export function createPortfolioSeedFromQuantity({
  stock,
  quantity,
  buyPrice,
  costCurrency = "USD"
}: {
  stock: string;
  quantity: number;
  buyPrice: number;
  costCurrency?: string;
}): PortfolioSeed {
  const symbol = stock.trim().toUpperCase();

  if (!symbol) throw new Error("Stock is required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) throw new Error("Buy price must be greater than zero");

  return normalizeSeed({
    id: "",
    symbol,
    quantity,
    costBasis: quantity * buyPrice,
    costCurrency
  });
}

export async function upsertMyPortfolioSeed(seed: PortfolioSeed): Promise<PortfolioSeed[]> {
  const normalized = normalizeSeed(seed);

  const { error } = await supabaseAdmin().from("holdings").upsert(
    {
      symbol: normalized.symbol,
      quantity: normalized.quantity,
      cost_basis: normalized.costBasis,
      cost_currency: normalized.costCurrency || "USD"
    },
    { onConflict: "symbol" }
  );

  if (error) throw new Error(`Could not save ${normalized.symbol}: ${error.message}`);
  return getMyPortfolioSeed();
}

export async function deleteMyPortfolioSeed(stock: string): Promise<PortfolioSeed[]> {
  const symbol = stock.trim().toUpperCase();
  if (!symbol) throw new Error("Stock is required");

  // Match the CSV behaviour, which compared symbols through normalizeSymbol,
  // so "BRK.B" still deletes a row stored as "BRK.B" or "BRK-B".
  const current = await getMyPortfolioSeed();
  const targets = current
    .filter((item) => portfolioSymbolKey(item.symbol) === portfolioSymbolKey(symbol))
    .map((item) => item.symbol);

  if (targets.length) {
    const { error } = await supabaseAdmin().from("holdings").delete().in("symbol", targets);
    if (error) throw new Error(`Could not delete ${symbol}: ${error.message}`);
  }

  return getMyPortfolioSeed();
}

/** Validates and rounds a seed to the precision the holdings table stores. */
function normalizeSeed(seed: PortfolioSeed): PortfolioSeed {
  const symbol = seed.symbol.trim().toUpperCase();
  const quantity = Number(seed.quantity);
  const costBasis = Number(seed.costBasis);
  const costCurrency = (seed.costCurrency || "USD").trim().toUpperCase();

  if (!symbol) throw new Error("Stock is required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${symbol} quantity must be greater than zero`);
  if (!Number.isFinite(costBasis) || costBasis <= 0) throw new Error(`${symbol} cost basis must be greater than zero`);

  return {
    id: seed.id || createPortfolioSeedId(symbol),
    symbol,
    quantity: roundTo(quantity, 8),
    costBasis: roundTo(costBasis, 2),
    costCurrency: costCurrency || "USD"
  };
}

function createPortfolioSeedId(symbol: string) {
  const key = symbol.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `my-port-${key || "stock"}`;
}

function portfolioSymbolKey(symbol: string) {
  return normalizeSymbol(symbol);
}

function roundTo(value: number, decimalPlaces: number) {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

