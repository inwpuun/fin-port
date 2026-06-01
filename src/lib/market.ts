import type { AssetType, Candle, DrawdownRange, MarketData, VolumePoint } from "@/types/market";

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
  ["BTC", "BTC-USD"],
  ["BITCOIN", "BTC-USD"],
  ["SP500", "^GSPC"],
  ["S&P500", "^GSPC"],
  ["NASDAQ", "^IXIC"],
  ["NDX", "^NDX"],
  ["DOW", "^DJI"],
  ["DJI", "^DJI"],
  ["VIX", "^VIX"],
  ["BRK.B", "BRK-B"],
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
  ["5y", 366 * 5]
]);

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

function getProviderRange(chartRange: string, drawdownRange: DrawdownRange) {
  const requiredDays = Math.max(getRangeDays(chartRange), getRangeDays(drawdownRange));
  if (requiredDays <= 31) return "1mo";
  if (requiredDays <= 93) return "3mo";
  if (requiredDays <= 186) return "6mo";
  if (requiredDays <= 366) return "1y";
  return "5y";
}

function filterCandlesByDays<T extends { time: string }>(items: T[], days: number) {
  const last = items.at(-1);
  if (!last) return items;
  const lastTime = new Date(`${last.time}T00:00:00Z`).getTime();
  const startTime = lastTime - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => new Date(`${item.time}T00:00:00Z`).getTime() >= startTime);
}

export function buildMarketData(
  result: YahooChartResult,
  symbol: string,
  chartRange = "6mo",
  drawdownRange: DrawdownRange = "1y"
): MarketData {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const allCandles: Candle[] = [];
  const allVolume: VolumePoint[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = quote.close?.[index] ?? adjclose[index];
    const open = quote.open?.[index] ?? close;
    const high = quote.high?.[index] ?? Math.max(open ?? 0, close ?? 0);
    const low = quote.low?.[index] ?? Math.min(open ?? 0, close ?? 0);
    const vol = quote.volume?.[index] ?? 0;

    if (![open, high, low, close].every((value) => Number.isFinite(value))) continue;

    const time = new Date(timestamps[index] * 1000).toISOString().slice(0, 10);
    const candle = {
      time,
      open: compactNumber(open as number),
      high: compactNumber(high as number),
      low: compactNumber(low as number),
      close: compactNumber(close as number)
    };

    allCandles.push(candle);
    allVolume.push({
      time,
      value: Number.isFinite(vol) ? Number(vol) : 0,
      color:
        (close as number) >= (open as number)
          ? "rgba(20, 206, 153, 0.34)"
          : "rgba(255, 82, 120, 0.34)"
    });
  }

  if (!allCandles.length) {
    throw new Error("No valid candles returned for this symbol");
  }

  const candles = filterCandlesByDays(allCandles, getRangeDays(chartRange));
  const chartTimeSet = new Set(candles.map((candle) => candle.time));
  const volume = allVolume.filter((item) => chartTimeSet.has(item.time));
  const drawdownCandles = filterCandlesByDays(allCandles, getRangeDays(drawdownRange));
  const first = candles[0];
  const last = candles.at(-1)!;
  const previous = candles.at(-2) || first;
  const change = last.close - previous.close;
  const changePercent = previous.close ? (change / previous.close) * 100 : 0;
  const rangeChange = first.close ? ((last.close - first.close) / first.close) * 100 : 0;
  const previousTop = calculatePreviousTop(drawdownCandles);
  const drawdownPercent = previousTop ? ((last.close - previousTop) / previousTop) * 100 : 0;
  const meta = result.meta || {};
  const known = knownMetadata.get(symbol);

  return {
    symbol,
    name: meta.longName || meta.shortName || known?.name || symbol,
    type: known?.type || classifySymbol(symbol),
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    price: last.close,
    previousClose: previous.close,
    change: compactNumber(change),
    changePercent: compactNumber(changePercent),
    rangeChange: compactNumber(rangeChange),
    previousTop: compactNumber(previousTop),
    drawdownPercent: compactNumber(drawdownPercent),
    drawdownRange,
    drawdownLabel: getDrawdownLabel(drawdownRange),
    candles,
    volume,
    marketTime: last.time || null,
    source: "Yahoo Finance chart API"
  };
}

export async function fetchMarketData(symbolInput: string, range = "6mo", interval = "1d", drawdownRange: DrawdownRange = "1y") {
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

  return buildMarketData(result, symbol, range, drawdownRange);
}

export function fallbackMarketData(symbolInput: string, range = "6mo", drawdownRange: DrawdownRange = "1y"): MarketData {
  const symbol = normalizeSymbol(symbolInput);
  const seed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const count = Math.max(getRangeDays(range), getRangeDays(drawdownRange));
  const base = symbol === "THB=X" ? 36 : symbol.includes("BTC") ? 65000 : symbol.includes("GC") ? 2350 : symbol.startsWith("^") ? 5200 : 180;
  const candles: Candle[] = [];
  const volume: VolumePoint[] = [];
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
    candles.push({
      time,
      open: compactNumber(open),
      high: compactNumber(high),
      low: compactNumber(low),
      close: compactNumber(close)
    });
    volume.push({
      time,
      value: Math.round(1_000_000 + Math.abs(wave) * 40_000 + seed * 1200),
      color: close >= open ? "rgba(20, 206, 153, 0.34)" : "rgba(255, 82, 120, 0.34)"
    });
  }

  const chartCandles = filterCandlesByDays(candles, getRangeDays(range));
  const chartTimeSet = new Set(chartCandles.map((candle) => candle.time));
  const chartVolume = volume.filter((item) => chartTimeSet.has(item.time));
  const drawdownCandles = filterCandlesByDays(candles, getRangeDays(drawdownRange));
  const first = chartCandles[0];
  const last = chartCandles.at(-1)!;
  const previous = chartCandles.at(-2)!;
  const change = last.close - previous.close;
  const previousTop = calculatePreviousTop(drawdownCandles);

  return {
    symbol,
    name: `${symbol} demo stream`,
    type: classifySymbol(symbol),
    currency: "USD",
    exchange: "simulated",
    price: last.close,
    previousClose: previous.close,
    change,
    changePercent: (change / previous.close) * 100,
    rangeChange: ((last.close - first.close) / first.close) * 100,
    previousTop,
    drawdownPercent: ((last.close - previousTop) / previousTop) * 100,
    drawdownRange,
    drawdownLabel: getDrawdownLabel(drawdownRange),
    candles: chartCandles,
    volume: chartVolume,
    marketTime: last.time,
    source: "offline demo data"
  };
}
