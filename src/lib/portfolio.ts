import type { Holding, HoldingWithMarket, PortfolioSeed } from "@/types/portfolio";
import type { MarketData } from "@/types/market";
import { toMarketSignal } from "@/lib/analytics";

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
    currency: market.currency,
    signal: toMarketSignal(market.analytics)
  };
}

export function createHoldingFromPortfolioSeed(seed: PortfolioSeed, market: MarketData, convertedCostBasis = seed.costBasis): Holding {
  const hasQuantityCost = Number.isFinite(seed.quantity) && Number.isFinite(convertedCostBasis) && seed.quantity! > 0;
  const profitRatio = 1 + (seed.profitLossPercent ?? 0) / 100;
  const quantity = hasQuantityCost ? seed.quantity! : market.price > 0 ? (seed.marketValue ?? 0) / market.price : 0;
  const buyPrice = hasQuantityCost
    ? convertedCostBasis! / quantity
    : profitRatio > 0
      ? market.price / profitRatio
      : market.price;

  return {
    id: seed.id,
    symbol: market.symbol,
    quantity,
    buyPrice
  };
}
