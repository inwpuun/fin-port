export type Holding = {
  id: string;
  symbol: string;
  quantity: number;
  buyPrice: number;
};

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
};
