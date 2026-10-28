import "server-only";
import { db } from "@/lib/db/client";
import { num } from "@/lib/db/sql";
import { fetchDailyCloses } from "@/lib/market";
import {
  CASH_CURRENCIES,
  CASH_SYMBOL,
  applyCash,
  applyTrade,
  isCashSide,
  isPositionTrade,
  listTransactions,
  symbolKey,
  type PositionState
} from "@/lib/trades";
import type { CashBalances, HoldingTransaction, NetWorthHistory, NetWorthPoint } from "@/types/portfolio";

/**
 * Rebuilds what the portfolio was worth on every day since the first trade,
 * by replaying the trade log against daily closes. Nothing is stored: the log
 * and Yahoo's history are enough, and a corrected trade redraws the whole
 * curve instead of leaving old snapshots behind that disagree with it.
 *
 * Positions without a trade log (a hand-entered GOLD or BTC row) cannot be
 * replayed, so they enter on the day their row was created, at cost. That
 * shows as a step in both lines -- net worth and money in rise together, so
 * the profit figure stays honest -- and the page names them so the step is
 * explained.
 */

const FX_SYMBOL = "THB=X";
const CACHE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Closes = { currency: string; closes: Map<string, number> };

declare global {
  var __finPortCloses: Map<string, { at: number; value: Closes }> | undefined;
}

/** Yahoo is the slow part; one page view asks for ~20 symbols at once. */
async function closesFor(symbol: string, from: string): Promise<Closes> {
  const cache = (globalThis.__finPortCloses ??= new Map());
  const key = `${symbol}|${from}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const { currency, closes } = await fetchDailyCloses(symbol, from);
  const value = { currency, closes };
  cache.set(key, { at: Date.now(), value });
  return value;
}

type HoldingRow = { symbol: string; quantity: string; cost_basis: string; cost_currency: string; created_on: string };
type CashRuleRow = { cash_value: string | null; cash_currency: string | null; created_on: string };

/** Today in Bangkok, which is the calendar the trades are dated in. */
function today() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function toUsd(amount: number, currency: string, fx: number) {
  return currency === "THB" ? amount / fx : amount;
}

export async function getNetWorthHistory(): Promise<NetWorthHistory> {
  const pool = db();
  const [trades, holdingResult, cashResult] = await Promise.all([
    listTransactions(pool),
    pool.query<HoldingRow>(
      `select symbol, quantity, cost_basis, cost_currency,
              to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as created_on
         from holdings`
    ),
    pool.query<CashRuleRow>(
      `select cash_value, cash_currency,
              to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as created_on
         from allocations where upper(symbol) = $1 order by created_at limit 1`,
      [CASH_SYMBOL]
    )
  ]);

  const events: HoldingTransaction[] = trades.filter((trade) => isPositionTrade(trade) || isCashSide(trade.side));
  const traded = new Set(events.filter(isPositionTrade).map((trade) => symbolKey(trade.symbol)));
  const untracked: string[] = [];

  for (const holding of holdingResult.rows) {
    const quantity = num(holding.quantity) ?? 0;
    const cost = num(holding.cost_basis) ?? 0;
    if (traded.has(symbolKey(holding.symbol)) || quantity <= 0) continue;

    untracked.push(holding.symbol);
    events.push({
      id: `untracked:${holding.symbol}`,
      symbol: holding.symbol,
      side: "buy",
      quantity,
      price: cost / quantity,
      fee: 0,
      currency: holding.cost_currency || "USD",
      occurredOn: holding.created_on,
      note: null
    });
  }

  const cashRule = cashResult.rows[0];
  const cashLiteral = num(cashRule?.cash_value) ?? 0;
  const cashLiteralCurrency = (cashRule?.cash_currency || "").toUpperCase();

  if (
    !events.some((event) => isCashSide(event.side)) &&
    cashLiteral > 0 &&
    (CASH_CURRENCIES as readonly string[]).includes(cashLiteralCurrency)
  ) {
    untracked.push(CASH_SYMBOL);
    events.push({
      id: "untracked:cash",
      symbol: CASH_SYMBOL,
      side: "deposit",
      quantity: cashLiteral,
      price: 1,
      fee: 0,
      currency: cashLiteralCurrency,
      occurredOn: cashRule!.created_on,
      note: null
    });
  }

  if (!events.length) return { points: [], unpriced: [], untracked };

  // Stable sort: same-day trades keep the order they were entered in.
  events.sort((first, second) => first.occurredOn.localeCompare(second.occurredOn));

  const start = events[0].occurredOn;
  // A week of slack so the first day already has a previous close to carry.
  const fetchFrom = addDays(start, -7);
  const positionKeys = [...new Set(events.filter(isPositionTrade).map((event) => symbolKey(event.symbol)))];

  const [fxResult, ...priceResults] = await Promise.allSettled([
    closesFor(FX_SYMBOL, fetchFrom),
    ...positionKeys.map((key) => closesFor(key, fetchFrom))
  ]);

  if (fxResult.status === "rejected") {
    throw new Error(`Could not load USD/THB history: ${fxResult.reason instanceof Error ? fxResult.reason.message : fxResult.reason}`);
  }

  const fxCloses = fxResult.value.closes;
  const prices = new Map<string, Closes>();
  const unpriced: string[] = [];

  priceResults.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value.closes.size) prices.set(positionKeys[index], result.value);
    else unpriced.push(positionKeys[index]);
  });

  // Carry the earliest known rate backwards so day one is never unconvertible.
  let fx = [...fxCloses.entries()].sort(([first], [second]) => first.localeCompare(second))[0]?.[1] ?? NaN;
  if (!Number.isFinite(fx)) throw new Error("USD/THB history came back empty");

  const lastClose = new Map<string, number>();
  const positions = new Map<string, PositionState & { currency: string }>();
  let cash: CashBalances = { USD: 0, THB: 0 };
  let cursor = 0;
  const points: NetWorthPoint[] = [];
  const end = today();

  for (let day = fetchFrom; day <= end; day = addDays(day, 1)) {
    fx = fxCloses.get(day) ?? fx;
    for (const [key, series] of prices) {
      const close = series.closes.get(day);
      if (close !== undefined) lastClose.set(key, close);
    }

    while (cursor < events.length && events[cursor].occurredOn <= day) {
      const event = events[cursor];
      cursor += 1;

      if (isCashSide(event.side)) {
        cash = applyCash(cash, event);
        continue;
      }

      const key = symbolKey(event.symbol);
      const current = positions.get(key) ?? { quantity: 0, cost: 0, currency: event.currency };
      positions.set(key, { ...applyTrade(current, event), currency: event.currency });
    }

    if (day < start) continue;

    const cashUsd = cash.USD + cash.THB / fx;
    let value = cashUsd;
    let invested = cashUsd;

    for (const [key, position] of positions) {
      if (position.quantity <= 0) continue;

      const cost = toUsd(position.cost, position.currency, fx);
      const close = lastClose.get(key);
      const series = prices.get(key);

      invested += cost;
      value += close !== undefined && series ? toUsd(position.quantity * close, series.currency, fx) : cost;
    }

    points.push({
      time: day,
      value: roundTo(value, 2),
      invested: roundTo(invested, 2),
      cash: roundTo(cashUsd, 2),
      fx: roundTo(fx, 4)
    });
  }

  // A symbol sold long ago that Yahoo no longer knows is not worth a warning.
  const held = new Set([...positions].filter(([, position]) => position.quantity > 0).map(([key]) => key));
  return { points, unpriced: unpriced.filter((key) => held.has(key)), untracked };
}

function roundTo(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
