import type { Candle, MarketData, VolumePoint } from "@/types/market";

/**
 * Chart-side indicators, computed in the browser from the bars the chart
 * already holds. Pure functions over candles, so the chart and the summary
 * panel beside it read the same numbers.
 */

/** Every bar a drawn chart can show: the warm-up lead, then the window. */
export function chartSeries(data: MarketData): { candles: Candle[]; volume: VolumePoint[]; windowStart: number } {
  const lead = data.overlays?.lead ?? [];
  const leadVolume = data.overlays?.leadVolume ?? [];
  return {
    candles: lead.length ? [...lead, ...data.candles] : data.candles,
    volume: leadVolume.length ? [...leadVolume, ...data.volume] : data.volume,
    windowStart: lead.length
  };
}

// --- CDC ActionZone V3 2020 -------------------------------------------------
//
// Piriya Sambandaraksa's TradingView study, defaults: source close, no
// smoothing, EMA 12 / EMA 26. The two averages set the side (fast above slow
// is bullish); where price sits against them picks one of six zones, which
// the original paints as bar colours. A BUY prints on the first green bar
// after a run that was bearish, a SELL on the first red bar after a bullish
// run -- the same barssince() logic as the Pine source.

export const CDC_FAST = 12;
export const CDC_SLOW = 26;

export type CdcZone = "green" | "blue" | "lightBlue" | "red" | "orange" | "yellow";

export type CdcSignal = { index: number; time: string; type: "buy" | "sell" };

export type CdcActionZone = {
  fast: number[];
  slow: number[];
  /** null while the slow average is still warming up. */
  zones: Array<CdcZone | null>;
  signals: CdcSignal[];
};

/** Pine's ema(): seeded with the first value, not an SMA. */
function ema(values: number[], period: number) {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let previous: number | null = null;

  for (const value of values) {
    previous = previous === null ? value : alpha * value + (1 - alpha) * previous;
    out.push(previous);
  }

  return out;
}

function cdcZone(price: number, fast: number, slow: number): CdcZone {
  const bullish = fast > slow;
  if (bullish) {
    if (price > fast) return "green";
    return price > slow ? "yellow" : "orange";
  }
  if (price < fast) return "red";
  return price > slow ? "blue" : "lightBlue";
}

export function cdcActionZone(candles: Candle[]): CdcActionZone {
  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes, CDC_FAST);
  const slow = ema(closes, CDC_SLOW);
  const zones: Array<CdcZone | null> = closes.map((close, index) =>
    index < CDC_SLOW - 1 ? null : cdcZone(close, fast[index], slow[index])
  );

  const signals: CdcSignal[] = [];
  let lastBuy: number | null = null;
  let lastSell: number | null = null;
  // Pine compares barssince() values, and any comparison with na is false, so
  // neither side counts until both conditions have fired at least once.
  let bullish = false;
  let bearish = false;

  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    const previous = zones[index - 1] ?? null;
    const buyCondition = zone === "green" && previous !== "green";
    const sellCondition = zone === "red" && previous !== "red";

    if (buyCondition && bearish) signals.push({ index, time: candles[index].time, type: "buy" });
    if (sellCondition && bullish) signals.push({ index, time: candles[index].time, type: "sell" });

    if (buyCondition) lastBuy = index;
    if (sellCondition) lastSell = index;
    bullish = lastBuy !== null && lastSell !== null && lastBuy > lastSell;
    bearish = lastBuy !== null && lastSell !== null && lastSell > lastBuy;
  }

  return { fast, slow, zones, signals };
}

export const cdcZoneCopy: Record<CdcZone, { label: string; note: string }> = {
  green: { label: "Green · buy zone", note: "EMA 12 above EMA 26 and price above both. The trend and the price agree: hold or buy." },
  yellow: { label: "Yellow · pullback", note: "Still bullish, but price has dipped under EMA 12 while holding above EMA 26. A dip inside an uptrend." },
  orange: { label: "Orange · warning", note: "Still bullish on the averages, but price is under both. The uptrend is losing its grip." },
  red: { label: "Red · sell zone", note: "EMA 12 below EMA 26 and price below the fast average. Bearish: stand aside or sell." },
  lightBlue: { label: "Light blue · bounce", note: "Bearish averages, price back above EMA 12 but not EMA 26. A bounce, not yet a turn." },
  blue: { label: "Blue · early recovery", note: "Bearish averages, but price is above both. The first sign of a turn: watch for green." }
};

// --- Regression trend -------------------------------------------------------
//
// TradingView's Regression Trend drawing: a least-squares line through the
// closes between two anchors, with +/-2 standard deviation edges and Pearson's
// R. The anchors here are the window's highest high and lowest low, in the
// order they happened, so the line runs high -> low in a decline and
// low -> high in a rally. It is fitted to the window asked for and nothing
// else: zooming the chart out never refits it.

export const REGRESSION_DEVIATIONS = 2;

export type RegressionTrend = {
  /** Indices into the candles passed in. */
  startIndex: number;
  endIndex: number;
  startTime: string;
  endTime: string;
  direction: "high-to-low" | "low-to-high";
  high: { time: string; price: number };
  low: { time: string; price: number };
  slope: number;
  /** Line value at startIndex. */
  intercept: number;
  sigma: number;
  pearsonR: number;
  bars: number;
  /** Fitted line, first anchor to last, in percent. */
  changePercent: number;
};

export function regressionTrend(candles: Candle[]): RegressionTrend | null {
  if (candles.length < 3) return null;

  let highIndex = 0;
  let lowIndex = 0;
  candles.forEach((candle, index) => {
    if (candle.high > candles[highIndex].high) highIndex = index;
    if (candle.low < candles[lowIndex].low) lowIndex = index;
  });

  const startIndex = Math.min(highIndex, lowIndex);
  const endIndex = Math.max(highIndex, lowIndex);
  const count = endIndex - startIndex + 1;
  if (count < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (let offset = 0; offset < count; offset += 1) {
    sumX += offset;
    sumY += candles[startIndex + offset].close;
  }
  const meanX = sumX / count;
  const meanY = sumY / count;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const dx = offset - meanX;
    const dy = candles[startIndex + offset].close - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const slope = sxx ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;
  let squared = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const residual = candles[startIndex + offset].close - (intercept + slope * offset);
    squared += residual * residual;
  }

  const startValue = intercept;
  const endValue = intercept + slope * (count - 1);

  return {
    startIndex,
    endIndex,
    startTime: candles[startIndex].time,
    endTime: candles[endIndex].time,
    direction: highIndex < lowIndex ? "high-to-low" : "low-to-high",
    high: { time: candles[highIndex].time, price: candles[highIndex].high },
    low: { time: candles[lowIndex].time, price: candles[lowIndex].low },
    slope,
    intercept,
    sigma: Math.sqrt(squared / count),
    pearsonR: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0,
    bars: count,
    changePercent: startValue ? ((endValue - startValue) / Math.abs(startValue)) * 100 : 0
  };
}

/** The fitted line at `index` (same indexing as the fit), optionally offset by deviations. */
export function regressionAt(trend: RegressionTrend, index: number, deviations = 0) {
  return trend.intercept + trend.slope * (index - trend.startIndex) + deviations * trend.sigma;
}
