import { analyseMarket } from "@/lib/analytics";
import type {
  AssetType,
  Candle,
  DrawdownRange,
  MarketData,
  MarketRange,
  VolumePoint
} from "@/types/market";

type YahooChartResult = {
  meta?: {
    currency?: string;
    exchangeName?: string;
    fullExchangeName?: string;
    longName?: string;
    shortName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
};

const aliases = new Map<string, string>([
  ["GOLD", "GC=F"],
  ["XAUUSD", "GC=F"],
  // The holdings sheet writes class-B shares with a dot; Yahoo wants a dash.
  ["BRK.B", "BRK-B"],
  ["BRK.A", "BRK-A"],
  ["BTC", "BTC-USD"],
  ["BITCOIN", "BTC-USD"],
  ["SP500", "^GSPC"],
  ["S&P500", "^GSPC"],
  ["NASDAQ", "^IXIC"],
  ["NDX", "^NDX"],
  ["DOW", "^DJI"],
  ["DJI", "^DJI"],
  ["VIX", "^VIX"],
  ["BRK/B", "BRK-B"]
]);

const knownMetadata = new Map<string, { name: string; type: AssetType }>([
  ["GC=F", { name: "Gold Futures", type: "commodity" }],
  ["BTC-USD", { name: "Bitcoin USD", type: "crypto" }],
  ["^GSPC", { name: "S&P 500", type: "index" }],
  ["^IXIC", { name: "Nasdaq Composite", type: "index" }],
  ["^NDX", { name: "Nasdaq 100", type: "index" }],
  ["^DJI", { name: "Dow Jones Industrial Average", type: "index" }],
  ["^VIX", { name: "CBOE Volatility Index", type: "index" }]
]);

const rangeDays = new Map<string, number>([
  ["1w", 7],
  ["2w", 14],
  ["1mo", 31],
  ["2mo", 62],
  ["3mo", 93],
  ["6mo", 186],
  ["1y", 366],
  ["2y", 366 * 2],
  ["5y", 366 * 5]
]);

/**
 * Every average, momentum figure and volatility estimate on the chart needs
 * bars from *before* the window to be defined on its first bar. Fourteen
 * months of slack covers the 200-day average and twelve-month momentum, so a
 * six-month chart still opens with a 200-day line already drawn.
 */
const WARMUP_DAYS = 420;

export const marketRanges: Array<{ value: MarketRange; short: string; label: string }> = [
  { value: "1mo", short: "1M", label: "1 month" },
  { value: "3mo", short: "3M", label: "3 months" },
  { value: "6mo", short: "6M", label: "6 months" },
  { value: "1y", short: "1Y", label: "1 year" },
  { value: "2y", short: "2Y", label: "2 years" },
  { value: "5y", short: "5Y", label: "5 years" }
];

export const drawdownRanges: Array<{ value: DrawdownRange; label: string }> = [
  { value: "1w", label: "1 week" },
  { value: "2w", label: "2 weeks" },
  { value: "1mo", label: "1 month" },
  { value: "2mo", label: "2 months" },
  { value: "3mo", label: "3 months" },
  { value: "1y", label: "1 year" }
];

export function normalizeDrawdownRange(value: string | null | undefined): DrawdownRange {
  const match = drawdownRanges.find((item) => item.value === value);
  return match?.value || "1y";
}

export function normalizeRange(value: string | null | undefined): MarketRange {
  const match = marketRanges.find((item) => item.value === value);
  return match?.value || "1y";
}

export function normalizeSymbol(rawSymbol: string | null | undefined) {
  const cleaned = String(rawSymbol || "").trim().toUpperCase();
  if (!cleaned) return "AAPL";
  return aliases.get(cleaned) || cleaned;
}

export function classifySymbol(symbol: string): AssetType {
  if (knownMetadata.has(symbol)) return knownMetadata.get(symbol)!.type;
  if (symbol.endsWith("-USD")) return "crypto";
  if (symbol.includes("=F")) return "commodity";
  if (symbol.startsWith("^")) return "index";
  return "equity";
}

function compactNumber(value: number) {
  return Number(value.toFixed(4));
}

function calculatePreviousTop(candles: Candle[]) {
  if (!candles.length) return 0;
  return candles.reduce((top, candle) => Math.max(top, candle.high), candles[0].high);
}

function getRangeDays(range: string) {
  return rangeDays.get(range) || rangeDays.get("6mo")!;
}

function getDrawdownLabel(range: DrawdownRange) {
  return drawdownRanges.find((item) => item.value === range)?.label || "1 year";
}

function getRangeLabel(range: MarketRange) {
  return marketRanges.find((item) => item.value === range)?.label || "1 year";
}

function getProviderRange(chartRange: string, drawdownRange: DrawdownRange) {
  const requiredDays = Math.max(getRangeDays(chartRange), getRangeDays(drawdownRange)) + WARMUP_DAYS;
  if (requiredDays <= 366) return "1y";
  if (requiredDays <= 366 * 2) return "2y";
  if (requiredDays <= 366 * 5) return "5y";
  return "10y";
}

/** First index within `days` of the last bar, so the window and its warm-up stay one array. */
function findWindowStart<T extends { time: string }>(items: T[], days: number) {
  const last = items.at(-1);
  if (!last) return 0;
  const startTime = new Date(`${last.time}T00:00:00Z`).getTime() - days * 24 * 60 * 60 * 1000;
  const index = items.findIndex((item) => new Date(`${item.time}T00:00:00Z`).getTime() >= startTime);
  return index < 0 ? 0 : index;
}

function assemble(
  history: Candle[],
  historyVolume: VolumePoint[],
  chartRange: MarketRange,
  drawdownRange: DrawdownRange,
  includeOverlays: boolean
) {
  const windowStart = findWindowStart(history, getRangeDays(chartRange));
  const candles = history.slice(windowStart);
  const volume = historyVolume.slice(windowStart);
  const drawdownCandles = history.slice(findWindowStart(history, getRangeDays(drawdownRange)));
  const first = candles[0];
  const last = candles.at(-1)!;
  const previous = candles.at(-2) || first;
  const change = last.close - previous.close;
  const previousTop = calculatePreviousTop(drawdownCandles);
  const { analytics, overlays } = analyseMarket(history, windowStart);

  return {
    candles,
    volume,
    analytics,
    overlays: includeOverlays ? overlays : undefined,
    price: last.close,
    previousClose: previous.close,
    change: compactNumber(change),
    changePercent: compactNumber(previous.close ? (change / previous.close) * 100 : 0),
    rangeChange: compactNumber(first.close ? ((last.close - first.close) / first.close) * 100 : 0),
    range: chartRange,
    rangeLabel: getRangeLabel(chartRange),
    previousTop: compactNumber(previousTop),
    drawdownPercent: compactNumber(previousTop ? ((last.close - previousTop) / previousTop) * 100 : 0),
    drawdownRange,
    drawdownLabel: getDrawdownLabel(drawdownRange),
    marketTime: last.time || null
  };
}

export function buildMarketData(
  result: YahooChartResult,
  symbol: string,
  chartRange: MarketRange = "1y",
  drawdownRange: DrawdownRange = "1y",
  includeOverlays = false
): MarketData {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const history: Candle[] = [];
  const historyVolume: VolumePoint[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = quote.close?.[index] ?? adjclose[index];
    const open = quote.open?.[index] ?? close;
    const high = quote.high?.[index] ?? Math.max(open ?? 0, close ?? 0);
    const low = quote.low?.[index] ?? Math.min(open ?? 0, close ?? 0);
    const vol = quote.volume?.[index] ?? 0;

    if (![open, high, low, close].every((value) => Number.isFinite(value))) continue;

    const time = new Date(timestamps[index] * 1000).toISOString().slice(0, 10);

    history.push({
      time,
      open: compactNumber(open as number),
      high: compactNumber(high as number),
      low: compactNumber(low as number),
      close: compactNumber(close as number)
    });
    historyVolume.push({
      time,
      value: Number.isFinite(vol) ? Number(vol) : 0,
      color:
        (close as number) >= (open as number)
          ? "rgba(20, 206, 153, 0.34)"
          : "rgba(255, 82, 120, 0.34)"
    });
  }

  if (!history.length) {
    throw new Error("No valid candles returned for this symbol");
  }

  const meta = result.meta || {};
  const known = knownMetadata.get(symbol);

  return {
    symbol,
    name: meta.longName || meta.shortName || known?.name || symbol,
    type: known?.type || classifySymbol(symbol),
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    source: "Yahoo Finance chart API",
    ...assemble(history, historyVolume, chartRange, drawdownRange, includeOverlays)
  };
}

export async function fetchMarketData(
  symbolInput: string,
  range: MarketRange = "1y",
  interval = "1d",
  drawdownRange: DrawdownRange = "1y",
  includeOverlays = false
) {
  const symbol = normalizeSymbol(symbolInput);
  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  yahooUrl.searchParams.set("range", getProviderRange(range, drawdownRange));
  yahooUrl.searchParams.set("interval", interval);
  yahooUrl.searchParams.set("includePrePost", "false");
  yahooUrl.searchParams.set("events", "div,splits");

  const response = await fetch(yahooUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "fin-port-next-dashboard/0.2"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Market provider returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const providerError = payload.chart?.error;
  const result = payload.chart?.result?.[0] as YahooChartResult | undefined;

  if (providerError) {
    throw new Error(providerError.description || providerError.code || "Market provider error");
  }
  if (!result) {
    throw new Error("No chart data returned for this symbol");
  }

  return buildMarketData(result, symbol, range, drawdownRange, includeOverlays);
}

export function fallbackMarketData(
  symbolInput: string,
  range: MarketRange = "1y",
  drawdownRange: DrawdownRange = "1y",
  includeOverlays = false
): MarketData {
  const symbol = normalizeSymbol(symbolInput);
  const seed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const count = Math.max(getRangeDays(range), getRangeDays(drawdownRange)) + WARMUP_DAYS;
  const base = symbol === "THB=X" ? 36 : symbol.includes("BTC") ? 65000 : symbol.includes("GC") ? 2350 : symbol.startsWith("^") ? 5200 : 180;
  const history: Candle[] = [];
  const historyVolume: VolumePoint[] = [];
  let price = base + (seed % 47);

  for (let index = count; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const wave = Math.sin((count - index + seed) / 5) * (base * 0.011);
    const drift = Math.cos((count - index) / 11) * (base * 0.004);
    const open = price;
    const close = Math.max(1, open + wave * 0.16 + drift);
    const high = Math.max(open, close) + Math.abs(wave) * 0.32 + base * 0.003;
    const low = Math.min(open, close) - Math.abs(drift) * 0.35 - base * 0.003;
    price = close;
    const time = date.toISOString().slice(0, 10);

    history.push({
      time,
      open: compactNumber(open),
      high: compactNumber(high),
      low: compactNumber(low),
      close: compactNumber(close)
    });
    historyVolume.push({
      time,
      value: Math.round(1_000_000 + Math.abs(wave) * 40_000 + seed * 1200),
      color: close >= open ? "rgba(20, 206, 153, 0.34)" : "rgba(255, 82, 120, 0.34)"
    });
  }

  return {
    symbol,
    name: `${symbol} demo stream`,
    type: classifySymbol(symbol),
    currency: "USD",
    exchange: "simulated",
    source: "offline demo data",
    ...assemble(history, historyVolume, range, drawdownRange, includeOverlays)
  };
}
