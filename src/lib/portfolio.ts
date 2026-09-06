import type { Holding, HoldingWithMarket } from "@/types/portfolio";
import type { MarketData } from "@/types/market";

/**
 * Combines a stored position with a live quote.
 *
 * `fxRate` converts the holding's cost currency into the quote currency; pass
 * 1 when they already match. Cost basis comes straight from the stored total
 * rather than being recomputed from a unit price, so fractional-share rounding
 * never drifts into the P/L.
 */
export function enrichHolding(
  holding: Holding,
  market: MarketData,
  fxRate = 1
): HoldingWithMarket {
  const marketValue = holding.quantity * market.price;
  const costBasisConverted = holding.costBasis * fxRate;
  const profitLoss = marketValue - costBasisConverted;
  const profitLossPercent = costBasisConverted ? (profitLoss / costBasisConverted) * 100 : 0;

  return {
    ...holding,
    symbol: market.symbol,
    name: market.name,
    currentPrice: market.price,
    marketValue,
    costBasisConverted,
    profitLoss,
    profitLossPercent,
    previousTop: market.previousTop,
    drawdownPercent: market.drawdownPercent,
    currency: market.currency
  };
}
