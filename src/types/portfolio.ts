export type Holding = {
  id: string;
  symbol: string;
  quantity: number;
  buyPrice: number;
};

export type PortfolioSeed = {
  id: string;
  symbol: string;
  marketValue?: number;
  profitLossPercent?: number;
  quantity?: number;
  costBasis?: number;
  costCurrency?: string;
};

export type AllocationRule = {
  category: string;
  symbol: string;
  cashValue?: number;
  cashCurrency?: string;
};

import type { MarketSignal } from "@/types/market";

export type HoldingWithMarket = Holding & {
  name: string;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  profitLoss: number;
  profitLossPercent: number;
  previousTop: number;
  drawdownPercent: number;
  currency: string;
  signal: MarketSignal;
};

export type TransactionSide = "buy" | "sell" | "dividend" | "fee" | "deposit" | "withdraw";

/** One row of the trade log. Cash moves are `deposit`/`withdraw` on the CASH symbol. */
export type HoldingTransaction = {
  id: string;
  symbol: string;
  side: TransactionSide;
  quantity: number;
  price: number;
  fee: number;
  currency: string;
  occurredOn: string;
  note: string | null;
};

/** Cash on hand per currency, the sum of every deposit less every withdrawal. */
export type CashBalances = {
  USD: number;
  THB: number;
};

export type NetWorthPoint = {
  time: string;
  /** Market value of every position plus cash, in USD. */
  value: number;
  /** Money put in: cost basis of what is held plus cash, in USD. */
  invested: number;
  /** The cash part of both figures, so profit can be read against cost alone. */
  cash: number;
  /** THB per USD that day, so the chart can redraw in baht without refetching. */
  fx: number;
};

export type NetWorthHistory = {
  points: NetWorthPoint[];
  /** Symbols whose price history could not be fetched; valued at cost instead. */
  unpriced: string[];
  /** Positions with no trade log, drawn from the day they were first recorded. */
  untracked: string[];
};
