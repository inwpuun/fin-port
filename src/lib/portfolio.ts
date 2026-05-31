import type { Holding, HoldingWithMarket } from "@/types/portfolio";
import type { MarketData } from "@/types/market";

export function createHolding(symbol: string, quantity: number, buyPrice: number): Holding {
  return {
    id: crypto.randomUUID(),
    symbol: symbol.trim().toUpperCase(),
    quantity,
    buyPrice
  };
}

export function enrichHolding(holding: Holding, market: MarketData): HoldingWithMarket {
  const marketValue = holding.quantity * market.price;
  const costBasis = holding.quantity * holding.buyPrice;
  const profitLoss = marketValue - costBasis;
  const profitLossPercent = costBasis ? (profitLoss / costBasis) * 100 : 0;

  return {
    ...holding,
    symbol: market.symbol,
    name: market.name,
    currentPrice: market.price,
    marketValue,
    costBasis,
    profitLoss,
    profitLossPercent,
    previousTop: market.previousTop,
    drawdownPercent: market.drawdownPercent,
    currency: market.currency
  };
}
