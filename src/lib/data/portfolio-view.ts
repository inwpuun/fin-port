import "server-only";
import { fetchMarketData, normalizeSymbol } from "@/lib/market";
import { enrichHolding } from "@/lib/portfolio";
import { getFxRate } from "@/lib/fx";
import { listAllocations, listHoldings } from "@/lib/data/portfolio";
import type { DrawdownRange, MarketData } from "@/types/market";
import type { AllocationBucket, HoldingWithMarket } from "@/types/portfolio";

export const BASE_CURRENCY = "USD";

export type PortfolioTotals = {
  marketValue: number;
  costBasis: number;
  profitLoss: number;
  profitLossPercent: number;
  cashValue: number;
  netWorth: number;
};

export type PortfolioView = {
  rows: HoldingWithMarket[];
  totals: PortfolioTotals;
  buckets: AllocationBucket[];
  baseCurrency: string;
  /** Symbols whose quote could not be fetched. Excluded from every total. */
  unavailable: Array<{ symbol: string; reason: string }>;
  /** True when an FX rate was missing, so totals mix currencies. */
  fxIncomplete: boolean;
  asOf: string;
};

const CASH_SYMBOL = "CASH";

/**
 * Assembles the whole portfolio picture on the server: stored positions from
 * Postgres, live quotes from the market provider, and FX so a THB cost basis
 * and a USD quote can be added up honestly.
 *
 * A symbol whose quote fails is reported in `unavailable` and left out of the
 * totals rather than being filled with demo data -- a net-worth figure built
 * partly from simulated prices would be worse than an obviously missing row.
 */
export async function buildPortfolioView(
  drawdownRange: DrawdownRange = "1y"
): Promise<PortfolioView> {
  const [holdings, allocations] = await Promise.all([listHoldings(), listAllocations()]);

  const quotes = await Promise.allSettled(
    holdings.map((holding) => fetchMarketData(holding.symbol, "1y", "1d", drawdownRange))
  );

  const unavailable: PortfolioView["unavailable"] = [];
  const priced: Array<{ holding: (typeof holdings)[number]; market: MarketData }> = [];

  holdings.forEach((holding, index) => {
    const settled = quotes[index];
    if (settled.status === "fulfilled") {
      priced.push({ holding, market: settled.value });
    } else {
      unavailable.push({
        symbol: holding.symbol,
        reason:
          settled.reason instanceof Error ? settled.reason.message : "Quote unavailable"
      });
    }
  });

  // Resolve every currency pair once instead of per row.
  const pairs = new Set<string>();
  for (const { holding, market } of priced) {
    pairs.add(`${holding.costCurrency}>${market.currency}`);
    pairs.add(`${market.currency}>${BASE_CURRENCY}`);
  }
  for (const allocation of allocations) {
    if (allocation.cashValue != null && allocation.cashCurrency) {
      pairs.add(`${allocation.cashCurrency}>${BASE_CURRENCY}`);
    }
  }

  const rates = new Map<string, number | null>();
  await Promise.all(
    [...pairs].map(async (pair) => {
      const [from, to] = pair.split(">");
      rates.set(pair, await getFxRate(from, to));
    })
  );

  let fxIncomplete = false;
  const rateFor = (from: string, to: string): number => {
    if (from === to) return 1;
    const rate = rates.get(`${from}>${to}`);
    if (rate == null) {
      fxIncomplete = true;
      return 1;
    }
    return rate;
  };

  const rows: HoldingWithMarket[] = [];
  const valueBySymbol = new Map<string, number>();
  const totals: PortfolioTotals = {
    marketValue: 0,
    costBasis: 0,
    profitLoss: 0,
    profitLossPercent: 0,
    cashValue: 0,
    netWorth: 0
  };

  for (const { holding, market } of priced) {
    const costToQuote = rateFor(holding.costCurrency, market.currency);
    const row = enrichHolding(holding, market, costToQuote);
    rows.push(row);

    const quoteToBase = rateFor(market.currency, BASE_CURRENCY);
    const marketValueBase = row.marketValue * quoteToBase;
    const costBase = holding.costBasis * rateFor(holding.costCurrency, BASE_CURRENCY);

    totals.marketValue += marketValueBase;
    totals.costBasis += costBase;

    // Bucket by the stored symbol, which is what the allocation sheet names.
    valueBySymbol.set(
      holding.symbol.toUpperCase(),
      (valueBySymbol.get(holding.symbol.toUpperCase()) ?? 0) + marketValueBase
    );
  }

  totals.profitLoss = totals.marketValue - totals.costBasis;
  totals.profitLossPercent = totals.costBasis
    ? (totals.profitLoss / totals.costBasis) * 100
    : 0;

  // Allocation buckets, including the CASH pseudo-symbol carrying a literal value.
  const byCategory = new Map<string, { symbols: string[]; value: number }>();
  for (const allocation of allocations) {
    const bucket = byCategory.get(allocation.category) ?? { symbols: [], value: 0 };
    bucket.symbols.push(allocation.symbol);

    if (allocation.symbol.toUpperCase() === CASH_SYMBOL) {
      const cash =
        (allocation.cashValue ?? 0) *
        rateFor(allocation.cashCurrency ?? BASE_CURRENCY, BASE_CURRENCY);
      bucket.value += cash;
      totals.cashValue += cash;
    } else {
      bucket.value += valueBySymbol.get(allocation.symbol.toUpperCase()) ?? 0;
    }

    byCategory.set(allocation.category, bucket);
  }

  totals.netWorth = totals.marketValue + totals.cashValue;

  const buckets: AllocationBucket[] = [...byCategory.entries()]
    .map(([category, bucket]) => ({
      category,
      symbols: bucket.symbols,
      marketValue: bucket.value,
      weightPercent: totals.netWorth ? (bucket.value / totals.netWorth) * 100 : 0,
      targetSymbolCount: bucket.symbols.length
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return {
    rows,
    totals,
    buckets,
    baseCurrency: BASE_CURRENCY,
    unavailable,
    fxIncomplete,
    asOf: new Date().toISOString()
  };
}

/** Resolves stored watchlist symbols to provider symbols for the chart. */
export function toProviderSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => normalizeSymbol(symbol)))];
}
