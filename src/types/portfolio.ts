export type Holding = {
  id: string;
  symbol: string;
  quantity: number;
  /** Total amount paid for the position, in costCurrency. */
  costBasis: number;
  costCurrency: string;
  /** Derived: costBasis / quantity. Kept for display and the market enrichers. */
  buyPrice: number;
};

export type HoldingWithMarket = Holding & {
  name: string;
  currentPrice: number;
  marketValue: number;
  /** costBasis converted into the market quote currency. */
  costBasisConverted: number;
  profitLoss: number;
  profitLossPercent: number;
  previousTop: number;
  drawdownPercent: number;
  currency: string;
};

export type Allocation = {
  id: string;
  category: string;
  symbol: string;
  cashValue: number | null;
  cashCurrency: string | null;
};

export type AllocationBucket = {
  category: string;
  symbols: string[];
  marketValue: number;
  weightPercent: number;
  targetSymbolCount: number;
};

export type WatchlistItem = {
  id: string;
  symbol: string;
  sortOrder: number;
};

export type CashAccount = {
  id: string;
  name: string;
  currency: string;
  currentBalance: number | null;
  balanceYear: number | null;
};

export type CashTransaction = {
  id: string;
  account: string;
  transferAccount: string | null;
  description: string;
  category: string | null;
  subcategory: string | null;
  occurredOn: string;
  occurredAt: string | null;
  memo: string | null;
  amount: number;
  currency: string;
  runningBalance: number | null;
  sourceYear: number | null;
};

export type MonthlySummary = {
  month: string;
  income: number;
  expense: number;
  net: number;
  txCount: number;
};

export type CategoryTotal = {
  category: string;
  expense: number;
  income: number;
  txCount: number;
};
