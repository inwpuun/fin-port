// Long-horizon read of a daily OHLC series, split into the three lenses a
// systematic desk actually keeps on screen: trend (time-series momentum),
// risk (drawdown and realised volatility) and value (distance from a fitted
// log trend). Nothing here is a backtested strategy -- it is the state of the
// evidence each lens reports, plus a weighted composite of the three.
//
// Pure math, no I/O, so both the server path and the offline fallback share it.
import type {
  Candle,
  MarketAnalytics,
  MarketOverlays,
  MarketSignal,
  TrendRegime,
  VerdictBias
} from "@/types/market";

const TRADING_DAYS = 252;
const TARGET_VOL = 15;
const VOL_WINDOW = 60;
const SLOPE_WINDOW = 63;

const LOOKBACK = {
  m1: 21,
  m3: 63,
  m6: 126,
  m12: 252
};

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Sample standard deviation: n-1, because these are observed returns and not
// the whole population of them.
function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function defined(values: Array<number | null>) {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

/** Share of history at or below `value`, as a percentage. */
function percentileRank(values: Array<number | null>, value: number | null) {
  if (value === null) return null;
  const pool = defined(values);
  if (pool.length < 20) return null;
  const below = pool.filter((item) => item <= value).length;
  return (below / pool.length) * 100;
}

function simpleMovingAverage(values: number[], period: number) {
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) out[index] = sum / period;
  }

  return out;
}

/** Log returns aligned to the bar they end on; bar 0 has none. */
function logReturns(closes: number[]) {
  const out: Array<number | null> = new Array(closes.length).fill(null);

  for (let index = 1; index < closes.length; index += 1) {
    if (closes[index] > 0 && closes[index - 1] > 0) {
      out[index] = Math.log(closes[index] / closes[index - 1]);
    }
  }

  return out;
}

/** Annualised realised volatility in percent, over a rolling window. */
function rollingVolatility(returns: Array<number | null>, period: number) {
  const out: Array<number | null> = new Array(returns.length).fill(null);

  for (let index = period; index < returns.length; index += 1) {
    const slice = defined(returns.slice(index - period + 1, index + 1));
    if (slice.length < period) continue;
    out[index] = stdev(slice) * Math.sqrt(TRADING_DAYS) * 100;
  }

  return out;
}

/**
 * Percent below the running peak, peak taken over everything loaded so far --
 * so the curve is honest about a high set before the visible window.
 */
function drawdownSeries(closes: number[]) {
  const out: number[] = new Array(closes.length).fill(0);
  const peakIndex: number[] = new Array(closes.length).fill(0);
  let peak = closes[0] ?? 0;
  let peakAt = 0;

  for (let index = 0; index < closes.length; index += 1) {
    if (closes[index] > peak) {
      peak = closes[index];
      peakAt = index;
    }
    out[index] = peak ? (closes[index] / peak - 1) * 100 : 0;
    peakIndex[index] = peakAt;
  }

  return { drawdown: out, peakIndex };
}

/** Wilder's ATR, expressed as a percentage of close so symbols compare. */
function atrPercent(candles: Candle[], period = 14) {
  if (candles.length <= period) return null;
  const trueRanges: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const previousClose = candles[index - 1].close;
    trueRanges.push(
      Math.max(
        candles[index].high - candles[index].low,
        Math.abs(candles[index].high - previousClose),
        Math.abs(candles[index].low - previousClose)
      )
    );
  }

  let atr = mean(trueRanges.slice(0, period));
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]) / period;
  }

  const last = candles.at(-1)!.close;
  return last ? (atr / last) * 100 : null;
}

function relativeStrength(closes: number[], period = 14) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }

  let averageGain = gain / period;
  let averageLoss = loss / period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (!averageLoss) return 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

type Regression = {
  slope: number;
  intercept: number;
  sigma: number;
  rSquared: number;
};

/** Ordinary least squares of y on the bar index. */
function regress(values: number[]): Regression | null {
  const count = values.length;
  if (count < 30) return null;

  const meanX = (count - 1) / 2;
  const meanY = mean(values);
  let covariance = 0;
  let varianceX = 0;

  for (let index = 0; index < count; index += 1) {
    covariance += (index - meanX) * (values[index] - meanY);
    varianceX += (index - meanX) ** 2;
  }
  if (!varianceX) return null;

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;
  let residualSum = 0;
  let totalSum = 0;

  for (let index = 0; index < count; index += 1) {
    residualSum += (values[index] - (intercept + slope * index)) ** 2;
    totalSum += (values[index] - meanY) ** 2;
  }

  return {
    slope,
    intercept,
    sigma: Math.sqrt(residualSum / Math.max(count - 2, 1)),
    rSquared: totalSum ? 1 - residualSum / totalSum : 0
  };
}

/**
 * Ornstein-Uhlenbeck half-life from an AR(1) fit on the residuals: how many
 * sessions it has historically taken to close half the gap to trend. Undefined
 * when the residual is not actually mean reverting (phi outside 0..1).
 */
function meanReversionHalfLife(residuals: number[]) {
  if (residuals.length < 60) return null;
  const lagged = residuals.slice(0, -1);
  const current = residuals.slice(1);
  const meanLagged = mean(lagged);
  const meanCurrent = mean(current);
  let covariance = 0;
  let variance = 0;

  for (let index = 0; index < lagged.length; index += 1) {
    covariance += (lagged[index] - meanLagged) * (current[index] - meanCurrent);
    variance += (lagged[index] - meanLagged) ** 2;
  }
  if (!variance) return null;

  const phi = covariance / variance;
  if (phi <= 0 || phi >= 1) return null;
  return -Math.LN2 / Math.log(phi);
}

function priceChange(closes: number[], from: number, to = closes.length - 1) {
  if (from < 0 || from >= closes.length || !closes[from]) return null;
  return (closes[to] / closes[from] - 1) * 100;
}

function classifyRegime(aboveSma200: boolean, momentum12: number | null): TrendRegime {
  const positive = (momentum12 ?? 0) > 0;
  if (aboveSma200) return positive ? "uptrend" : "recovery";
  return positive ? "pullback" : "downtrend";
}

const verdictLabels: Record<VerdictBias, string> = {
  accumulate: "Accumulate",
  add: "Add on weakness",
  hold: "Hold",
  trim: "Trim",
  avoid: "Stand aside"
};

/**
 * @param history every bar fetched, including the warm-up before the window
 * @param windowStart index in `history` of the first bar the chart shows
 */
export function analyseMarket(history: Candle[], windowStart: number) {
  const closes = history.map((candle) => candle.close);
  const lastIndex = closes.length - 1;
  const last = closes[lastIndex];
  const sma50 = simpleMovingAverage(closes, 50);
  const sma100 = simpleMovingAverage(closes, 100);
  const sma200 = simpleMovingAverage(closes, 200);
  const returns = logReturns(closes);
  const volatility = rollingVolatility(returns, VOL_WINDOW);
  const { drawdown, peakIndex } = drawdownSeries(closes);

  // --- Trend -------------------------------------------------------------
  const latestSma50 = sma50[lastIndex];
  const latestSma200 = sma200[lastIndex];
  const priceVsSma200 = latestSma200 ? (last / latestSma200 - 1) * 100 : null;
  const priceVsSma50 = latestSma50 ? (last / latestSma50 - 1) * 100 : null;
  const priorSma200 = sma200[lastIndex - SLOPE_WINDOW] ?? null;
  const sma200Slope =
    latestSma200 && priorSma200
      ? (latestSma200 / priorSma200 - 1) * (TRADING_DAYS / SLOPE_WINDOW) * 100
      : null;

  let barsAboveSma200 = 0;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const average = sma200[index];
    if (average === null) break;
    const above = closes[index] > average;
    if (index === lastIndex) {
      barsAboveSma200 = above ? 1 : -1;
      continue;
    }
    if (above !== barsAboveSma200 > 0) break;
    barsAboveSma200 += barsAboveSma200 > 0 ? 1 : -1;
  }

  const crosses: Array<{ time: string; type: "golden" | "death" }> = [];
  let previousSign = 0;
  for (let index = 0; index <= lastIndex; index += 1) {
    const fast = sma50[index];
    const slow = sma200[index];
    if (fast === null || slow === null) continue;
    const sign = Math.sign(fast - slow);
    if (sign !== 0 && previousSign !== 0 && sign !== previousSign) {
      crosses.push({ time: history[index].time, type: sign > 0 ? "golden" : "death" });
    }
    if (sign !== 0) previousSign = sign;
  }

  const lastCrossEntry = crosses.at(-1) || null;
  const lastCrossIndex = lastCrossEntry ? history.findIndex((candle) => candle.time === lastCrossEntry.time) : -1;
  const momentum = {
    m1: priceChange(closes, lastIndex - LOOKBACK.m1),
    m3: priceChange(closes, lastIndex - LOOKBACK.m3),
    m6: priceChange(closes, lastIndex - LOOKBACK.m6),
    m12: priceChange(closes, lastIndex - LOOKBACK.m12),
    // 12-1: the twelve-month move excluding the last month, which is the form
    // the momentum literature uses because the most recent month reverses.
    m12x1:
      lastIndex - LOOKBACK.m12 >= 0 && closes[lastIndex - LOOKBACK.m12]
        ? (closes[lastIndex - LOOKBACK.m1] / closes[lastIndex - LOOKBACK.m12] - 1) * 100
        : null
  };
  const regime = classifyRegime(barsAboveSma200 > 0, momentum.m12);

  // --- Risk --------------------------------------------------------------
  const allReturns = defined(returns);
  const dailyMean = mean(allReturns);
  const dailyStdev = stdev(allReturns);
  const downside = Math.sqrt(mean(allReturns.map((value) => Math.min(value, 0) ** 2)));
  const annualReturn = dailyMean * TRADING_DAYS * 100;
  const annualVol = dailyStdev * Math.sqrt(TRADING_DAYS) * 100;
  const cagr = allReturns.length
    ? (Math.exp(dailyMean * TRADING_DAYS) - 1) * 100
    : null;
  const maxDrawdown = Math.min(...drawdown);
  const currentDrawdown = drawdown[lastIndex];
  const volatility20 = rollingVolatility(returns, 20)[lastIndex];
  const volatility252 = rollingVolatility(returns, TRADING_DAYS)[lastIndex];
  const latestVolatility = volatility[lastIndex];
  const volatilityMedian = median(defined(volatility));
  const peakAt = peakIndex[lastIndex];
  const ulcer = Math.sqrt(mean(drawdown.slice(windowStart).map((value) => value ** 2)));

  // --- Value -------------------------------------------------------------
  // Fit on the window only: a regression channel is a statement about the
  // stretch of trend you are looking at, not about all history.
  const windowCloses = closes.slice(windowStart);
  const logWindow = windowCloses.map((value) => Math.log(Math.max(value, 1e-9)));
  const fit = regress(logWindow);
  const zSeries: Array<number | null> = new Array(closes.length).fill(null);
  const residuals: number[] = [];
  const bandAt = (offset: number, sigmas: number) =>
    fit ? round(Math.exp(fit.intercept + fit.slope * offset + sigmas * fit.sigma)) : null;

  if (fit && fit.sigma > 0) {
    for (let offset = 0; offset < logWindow.length; offset += 1) {
      const residual = logWindow[offset] - (fit.intercept + fit.slope * offset);
      residuals.push(residual);
      zSeries[windowStart + offset] = residual / fit.sigma;
    }
  }

  const zScore = zSeries[lastIndex];
  const lastOffset = logWindow.length - 1;

  // --- Composite ---------------------------------------------------------
  const volatilityPercentile = percentileRank(volatility, latestVolatility);
  const drawdownPercentile = percentileRank(drawdown.map((value) => -value), -currentDrawdown);
  const trendScore =
    clamp((priceVsSma200 ?? 0) / 12, -1, 1) * 0.55 + clamp((momentum.m12x1 ?? 0) / 25, -1, 1) * 0.45;
  const valueScore = zScore === null ? 0 : clamp(-zScore / 2, -1, 1);
  const riskScore = volatilityPercentile === null ? 0 : clamp((50 - volatilityPercentile) / 50, -1, 1);
  const score = trendScore * 0.45 + valueScore * 0.35 + riskScore * 0.2;
  const bias: VerdictBias =
    score >= 0.35 ? "accumulate" : score >= 0.1 ? "add" : score > -0.1 ? "hold" : score > -0.35 ? "trim" : "avoid";
  const reasons = [
    priceVsSma200 === null
      ? "Not enough history for a 200-day average"
      : `${priceVsSma200 >= 0 ? "Above" : "Below"} the 200-day average by ${Math.abs(priceVsSma200).toFixed(1)}%, ${Math.abs(barsAboveSma200)} sessions running`,
    momentum.m12x1 === null
      ? "Not enough history for twelve-month momentum"
      : `Twelve-month momentum excluding the last month is ${momentum.m12x1 >= 0 ? "+" : ""}${momentum.m12x1.toFixed(1)}%`,
    zScore === null
      ? "Not enough bars to fit a trend channel"
      : `${Math.abs(zScore).toFixed(2)} sigma ${zScore >= 0 ? "above" : "below"} the fitted trend`,
    latestVolatility === null || volatilityPercentile === null
      ? "Not enough history for a volatility percentile"
      : `Realised volatility ${latestVolatility.toFixed(1)}% sits in the ${volatilityPercentile.toFixed(0)}th percentile of its own history`,
    `Currently ${Math.abs(currentDrawdown).toFixed(1)}% below the ${history[peakAt]?.time || "prior"} peak, against a worst of ${Math.abs(maxDrawdown).toFixed(1)}%`
  ];

  const analytics: MarketAnalytics = {
    bars: closes.length - windowStart,
    historyBars: closes.length,
    historyFrom: history[0]?.time || "",
    trend: {
      sma50: round(latestSma50),
      sma100: round(sma100[lastIndex]),
      sma200: round(latestSma200),
      priceVsSma50: round(priceVsSma50, 2),
      priceVsSma200: round(priceVsSma200, 2),
      sma200Slope: round(sma200Slope, 2),
      barsAboveSma200,
      lastCross: lastCrossEntry
        ? { ...lastCrossEntry, barsSince: lastCrossIndex >= 0 ? lastIndex - lastCrossIndex : 0 }
        : null,
      regime,
      momentum: {
        m1: round(momentum.m1, 2),
        m3: round(momentum.m3, 2),
        m6: round(momentum.m6, 2),
        m12: round(momentum.m12, 2),
        m12x1: round(momentum.m12x1, 2)
      }
    },
    risk: {
      vol20: round(volatility20, 2),
      vol60: round(latestVolatility, 2),
      vol252: round(volatility252, 2),
      volPercentile: round(volatilityPercentile, 1),
      volMedian: round(volatilityMedian, 2),
      atrPercent: round(atrPercent(history), 2),
      drawdown: round(currentDrawdown, 2)!,
      maxDrawdown: round(maxDrawdown, 2)!,
      drawdownPercentile: round(drawdownPercentile, 1),
      ulcerIndex: round(ulcer, 2)!,
      peakPrice: round(closes[peakAt])!,
      peakTime: history[peakAt]?.time || "",
      barsSincePeak: lastIndex - peakAt,
      cagr: round(cagr, 2),
      sharpe: annualVol ? round(annualReturn / annualVol, 2) : null,
      sortino: downside ? round(annualReturn / (downside * Math.sqrt(TRADING_DAYS) * 100), 2) : null,
      calmar: maxDrawdown ? round((cagr ?? 0) / Math.abs(maxDrawdown), 2) : null,
      volTargetWeight: latestVolatility ? round(Math.min((TARGET_VOL / latestVolatility) * 100, 200), 1) : null
    },
    value: {
      logFit: fit ? { slope: fit.slope, intercept: fit.intercept, sigma: fit.sigma } : null,
      slopeAnnual: fit ? round((Math.exp(fit.slope * TRADING_DAYS) - 1) * 100, 2) : null,
      rSquared: fit ? round(fit.rSquared, 3) : null,
      sigmaPercent: fit ? round((Math.exp(fit.sigma) - 1) * 100, 2) : null,
      zScore: round(zScore, 2),
      zPercentile: round(percentileRank(zSeries, zScore), 1),
      halfLifeDays: round(meanReversionHalfLife(residuals), 1),
      midline: bandAt(lastOffset, 0),
      upper1: bandAt(lastOffset, 1),
      lower1: bandAt(lastOffset, -1),
      upper2: bandAt(lastOffset, 2),
      lower2: bandAt(lastOffset, -2),
      longTermReturn: round(priceChange(closes, 0), 2),
      rsi14: round(relativeStrength(closes), 1)
    },
    verdict: {
      score: round(score, 3)!,
      bias,
      label: verdictLabels[bias],
      trendScore: round(trendScore, 3)!,
      valueScore: round(valueScore, 3)!,
      riskScore: round(riskScore, 3)!,
      reasons
    }
  };

  // Only what cannot be recomputed from `candles` plus the scalars above: the
  // averages and the volatility need warm-up bars the window does not carry,
  // and the drawdown needs a peak that may sit before it.
  const overlays: MarketOverlays = {
    sma50: sma50.slice(windowStart).map((value) => round(value)),
    sma200: sma200.slice(windowStart).map((value) => round(value)),
    volatility: volatility.slice(windowStart).map((value) => round(value, 2)),
    drawdown: drawdown.slice(windowStart).map((value) => round(value, 2)!),
    crosses: crosses.filter((cross) => cross.time >= (history[windowStart]?.time || ""))
  };

  return { analytics, overlays };
}

/** Table-sized view of a full analysis: enough for one cell and a sort key. */
export function toMarketSignal(analytics: MarketAnalytics): MarketSignal {
  return {
    regime: analytics.trend.regime,
    bias: analytics.verdict.bias,
    label: analytics.verdict.label,
    score: analytics.verdict.score,
    priceVsSma200: analytics.trend.priceVsSma200,
    zScore: analytics.value.zScore
  };
}
