import "server-only";
import { toMarketSignal } from "@/lib/analytics";
import { getUsdThbRateOrNull } from "@/lib/bot-rate";
import { db } from "@/lib/db/client";
import { fetchMarketSummary, normalizeSymbol } from "@/lib/market";
import { getMyAllocationRules, getMyPortfolioSeed } from "@/lib/my-port";
import { CASH_SYMBOL, getCashBalances, listTransactions, symbolKey } from "@/lib/trades";
import type { CashBalances } from "@/types/portfolio";

/**
 * The portfolio as /portfolio shows it, priced on the server, for callers
 * that cannot run the page: the ZeroClaw agent, curl, scripts.
 *
 * Valued the same way the page does it, so the agent and the page agree:
 *  - a THB cost basis, THB cash and anything quoted in THB convert to USD at
 *    the market rate (Yahoo THB=X), the rate the page converts them at;
 *  - USD figures then display in baht at the Bank of Thailand reference rate,
 *    the page's THB toggle, falling back to THB=X when BOT is unavailable.
 *
 * Prices are the last daily close (Yahoo, cached a minute). `day*` fields
 * compare it with the close before.
 */

export type SummaryCurrency = "USD" | "THB";

export type HoldingRecord = {
  symbol: string;
  category: string | null;
  quantity: number;
  /** Total paid, in costCurrency. */
  costBasis: number;
  costCurrency: string;
  /** costBasis / quantity, in costCurrency. */
  averageCost: number;
  /** Rows in the trade log for this position; 0 means it was entered by hand. */
  trades: number;
};

export async function getHoldings(): Promise<{ holdings: HoldingRecord[]; cash: CashBalances }> {
  const [seeds, rules, transactions, cash] = await Promise.all([
    getMyPortfolioSeed(),
    getMyAllocationRules(),
    listTransactions(db()),
    getCashBalances(db())
  ]);

  const lane = new Map(rules.map((rule) => [symbolKey(rule.symbol), rule.category]));
  const counts = new Map<string, number>();
  for (const row of transactions) {
    if (row.side !== "buy" && row.side !== "sell") continue;
    const key = symbolKey(row.symbol);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const holdings = seeds
    .filter((seed) => (seed.quantity ?? 0) > 0)
    .map((seed) => {
      const quantity = seed.quantity ?? 0;
      const costBasis = seed.costBasis ?? 0;
      const key = symbolKey(seed.symbol);
      return {
        symbol: seed.symbol,
        category: lane.get(key) ?? null,
        quantity,
        costBasis: round(costBasis, 4),
        costCurrency: seed.costCurrency || "USD",
        averageCost: round(quantity ? costBasis / quantity : 0, 6),
        trades: counts.get(key) ?? 0
      };
    });

  return { holdings, cash };
}

export async function buildPortfolioSummary({
  currency = "THB",
  symbols
}: { currency?: SummaryCurrency; symbols?: string[] } = {}) {
  const { holdings: all, cash } = await getHoldings();
  const wanted = symbols?.length ? new Set(symbols.map((symbol) => symbolKey(symbol))) : null;
  const holdings = wanted ? all.filter((holding) => wanted.has(symbolKey(holding.symbol))) : all;

  const [fxResult, bot, ...markets] = await Promise.all([
    fetchMarketSummary("THB=X").then(
      (data) => data.price,
      () => null
    ),
    getUsdThbRateOrNull(),
    ...holdings.map((holding) =>
      fetchMarketSummary(holding.symbol).then(
        (data) => ({ ok: true as const, data }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) })
      )
    )
  ]);

  const marketThb = fxResult && fxResult > 0 ? fxResult : null;
  const displayRate = bot?.rate ?? marketThb;
  if (currency === "THB" && !displayRate) throw new Error("No USD/THB rate (BOT and Yahoo THB=X both failed); ask for currency=USD");

  const errors: Record<string, string> = {};
  const toUsd = (amount: number, from: string) => {
    if (from === "USD") return amount;
    if (from === "THB" && marketThb) return amount / marketThb;
    return null;
  };
  const show = (usd: number) => round(currency === "THB" ? usd * displayRate! : usd, 2);

  type Row = {
    symbol: string;
    name: string;
    category: string | null;
    quantity: number;
    averageCost: number;
    costCurrency: string;
    price: number;
    priceCurrency: string;
    previousClose: number;
    priceChangePercent: number;
    usd: { value: number; cost: number; day: number };
    drawdownPercent: number;
    signal: { label: string; bias: string; regime: string; score: number };
  };

  const rows: Row[] = [];
  holdings.forEach((holding, index) => {
    const market = markets[index];
    if (!market.ok) {
      errors[holding.symbol] = market.error;
      return;
    }
    const data = market.data;
    const value = toUsd(holding.quantity * data.price, data.currency);
    const day = toUsd(holding.quantity * (data.price - data.previousClose), data.currency);
    const cost = toUsd(holding.costBasis, holding.costCurrency);
    if (value === null || day === null || cost === null) {
      errors[holding.symbol] = `No rate to convert ${data.currency}/${holding.costCurrency} to USD`;
      return;
    }
    const signal = toMarketSignal(data.analytics);
    rows.push({
      symbol: holding.symbol,
      name: data.name,
      category: holding.category,
      quantity: holding.quantity,
      averageCost: holding.averageCost,
      costCurrency: holding.costCurrency,
      price: data.price,
      priceCurrency: data.currency,
      previousClose: data.previousClose,
      priceChangePercent: data.changePercent,
      usd: { value, cost, day },
      drawdownPercent: data.drawdownPercent,
      signal: { label: signal.label, bias: signal.bias, regime: signal.regime, score: signal.score }
    });
  });

  const sum = (pick: (row: Row) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const valueUsd = sum((row) => row.usd.value);
  const costUsd = sum((row) => row.usd.cost);
  const dayUsd = sum((row) => row.usd.day);
  const cashUsd = cash.USD + (marketThb ? cash.THB / marketThb : 0);
  if (cash.THB && !marketThb) errors[CASH_SYMBOL] = "THB cash left out: no USD/THB market rate";
  // Cash only belongs in the totals when the whole portfolio was asked for.
  const withCash = !wanted;

  const percent = (part: number, whole: number) => round(whole ? (part / whole) * 100 : 0, 2);

  return {
    asOf: new Date().toISOString(),
    currency,
    fx: {
      usdThbMarket: marketThb,
      usdThbReference: bot ? { rate: bot.rate, period: bot.period, source: bot.source } : null,
      displayRate: currency === "THB" ? displayRate : 1
    },
    totals: {
      marketValue: show(valueUsd),
      costBasis: show(costUsd),
      profitLoss: show(valueUsd - costUsd),
      profitLossPercent: percent(valueUsd - costUsd, costUsd),
      dayChange: show(dayUsd),
      dayChangePercent: percent(dayUsd, valueUsd - dayUsd),
      ...(withCash
        ? {
            cash: show(cashUsd),
            netWorth: show(valueUsd + cashUsd),
            moneyIn: show(costUsd + cashUsd)
          }
        : {})
    },
    cash: withCash ? { USD: cash.USD, THB: cash.THB, value: show(cashUsd) } : undefined,
    holdings: rows
      .sort((a, b) => b.usd.value - a.usd.value)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        category: row.category,
        quantity: row.quantity,
        averageCost: row.averageCost,
        costCurrency: row.costCurrency,
        price: row.price,
        priceCurrency: row.priceCurrency,
        previousClose: row.previousClose,
        priceChangePercent: row.priceChangePercent,
        marketValue: show(row.usd.value),
        costBasis: show(row.usd.cost),
        profitLoss: show(row.usd.value - row.usd.cost),
        profitLossPercent: percent(row.usd.value - row.usd.cost, row.usd.cost),
        dayChange: show(row.usd.day),
        weightPercent: percent(row.usd.value, withCash ? valueUsd + cashUsd : valueUsd),
        drawdownPercent: round(row.drawdownPercent, 2),
        signal: row.signal
      })),
    errors
  };
}

export function parseSymbols(raw: string | null) {
  return [...new Set((raw || "").split(",").map((symbol) => symbol.trim()).filter(Boolean).map((symbol) => normalizeSymbol(symbol)))];
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
