import "server-only";
import { query, withTransaction } from "@/lib/db/client";
import { num } from "@/lib/db/sql";
import { normalizeSymbol } from "@/lib/market";
import type { AllocationRule, PortfolioSeed } from "@/types/portfolio";

/**
 * Portfolio storage. The exported surface is unchanged from the CSV version,
 * so every page and route handler above it keeps working -- only the backing
 * store moved to Postgres.
 *
 * The CSV version wrote back to public/my-port.csv, which needs a writable
 * filesystem that not every host provides, and made two containers sharing
 * one portfolio impossible. Postgres removes both constraints.
 */

type PortfolioHoldingValueInput = {
  stock: string;
  holdingValue: number;
  profitPercent: number;
  marketPrice: number;
};

type HoldingRow = {
  symbol: string;
  quantity: string;
  cost_basis: string;
  cost_currency: string | null;
};

type AllocationRow = {
  category: string;
  symbol: string;
  cash_value: string | null;
  cash_currency: string | null;
};

function rowToSeed(row: HoldingRow): PortfolioSeed {
  const symbol = row.symbol.trim().toUpperCase();
  return {
    id: createPortfolioSeedId(symbol),
    symbol,
    quantity: num(row.quantity) ?? 0,
    costBasis: num(row.cost_basis) ?? 0,
    costCurrency: (row.cost_currency || "USD").toUpperCase()
  };
}

export async function getMyPortfolioSeed(): Promise<PortfolioSeed[]> {
  try {
    const rows = await query<HoldingRow>(
      `select symbol, quantity, cost_basis, cost_currency
         from holdings
        order by sort_order, symbol`
    );
    return rows.map(rowToSeed);
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
    const rows = await query<AllocationRow>(
      `select category, symbol, cash_value, cash_currency
         from allocations
        order by sort_order, category, symbol`
    );

    return rows.map((row) => {
      const cashValue = num(row.cash_value);
      const cashCurrency = row.cash_currency || undefined;

      return {
        category: row.category,
        symbol: row.symbol.toUpperCase(),
        ...(cashValue === null ? {} : { cashValue }),
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
 * Both statements run in one transaction: a failure between them would leave
 * the symbol in no lane at all.
 */
export async function upsertMyAllocationRule(rule: AllocationRuleInput): Promise<AllocationRule[]> {
  const symbol = rule.symbol.trim().toUpperCase();
  const category = rule.category.trim();

  if (!symbol) throw new Error("Symbol is required");
  if (!category) throw new Error("Category is required");

  const cashValue = Number.isFinite(Number(rule.cashValue)) ? Number(rule.cashValue) : null;
  const cashCurrency = (rule.cashCurrency || "").trim().toUpperCase() || null;

  try {
    await withTransaction(async (client) => {
      await client.query(`delete from allocations where symbol = $1 and category <> $2`, [
        symbol,
        category
      ]);

      await client.query(
        `insert into allocations (category, symbol, cash_value, cash_currency)
              values ($1, $2, $3, $4)
         on conflict (category, symbol)
         do update set cash_value = excluded.cash_value,
                       cash_currency = excluded.cash_currency`,
        [category, symbol, cashValue, cashCurrency]
      );
    });
  } catch (error) {
    throw new Error(`Could not save ${symbol} allocation: ${message(error)}`);
  }

  return getMyAllocationRules();
}

/** Removes a symbol from every allocation lane. */
export async function deleteMyAllocationRule(symbol: string): Promise<AllocationRule[]> {
  const clean = symbol.trim().toUpperCase();
  if (!clean) throw new Error("Symbol is required");

  try {
    await query(`delete from allocations where symbol = $1`, [clean]);
  } catch (error) {
    throw new Error(`Could not delete ${clean} allocation: ${message(error)}`);
  }

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

  try {
    await query(
      `insert into holdings (symbol, quantity, cost_basis, cost_currency)
            values ($1, $2, $3, $4)
       on conflict (symbol)
       do update set quantity = excluded.quantity,
                     cost_basis = excluded.cost_basis,
                     cost_currency = excluded.cost_currency`,
      [normalized.symbol, normalized.quantity, normalized.costBasis, normalized.costCurrency || "USD"]
    );
  } catch (error) {
    throw new Error(`Could not save ${normalized.symbol}: ${message(error)}`);
  }

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
    try {
      await query(`delete from holdings where symbol = any($1::text[])`, [targets]);
    } catch (error) {
      throw new Error(`Could not delete ${symbol}: ${message(error)}`);
    }
  }

  return getMyPortfolioSeed();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
