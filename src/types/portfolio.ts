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
