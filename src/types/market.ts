export type AssetType = "equity" | "crypto" | "commodity" | "index";
export type DrawdownRange = "1w" | "2w" | "1mo" | "2mo" | "3mo" | "1y";
export type MarketRange = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";

/** The three lenses the chart can be read through. See docs/chart-methods.md. */
export type ChartView = "trend" | "risk" | "value";
export type TrendRegime = "uptrend" | "recovery" | "pullback" | "downtrend";
export type VerdictBias = "accumulate" | "add" | "hold" | "trim" | "avoid";

/** The one-glance read a table row shows, distilled from the three lenses. */
export type MarketSignal = {
  regime: TrendRegime;
  bias: VerdictBias;
  label: string;
  score: number;
  priceVsSma200: number | null;
  zScore: number | null;
};

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type VolumePoint = {
  time: string;
  value: number;
  color: string;
};

export type MarketAnalytics = {
  /** Bars in the visible window. */
  bars: number;
  /** Bars actually loaded, window plus the warm-up the averages need. */
  historyBars: number;
  historyFrom: string;
  trend: {
    sma50: number | null;
    sma100: number | null;
    sma200: number | null;
    priceVsSma50: number | null;
    priceVsSma200: number | null;
    /** 200-day average's own slope over the last quarter, annualised. */
    sma200Slope: number | null;
    /** Consecutive sessions on one side of the 200-day average; negative = below. */
    barsAboveSma200: number;
    lastCross: { time: string; type: "golden" | "death"; barsSince: number } | null;
    regime: TrendRegime;
    momentum: {
      m1: number | null;
      m3: number | null;
      m6: number | null;
      m12: number | null;
      /** Twelve months excluding the most recent one. */
      m12x1: number | null;
    };
  };
  risk: {
    vol20: number | null;
    vol60: number | null;
    vol252: number | null;
    volPercentile: number | null;
    volMedian: number | null;
    atrPercent: number | null;
    drawdown: number;
    maxDrawdown: number;
    /** How deep today is against every other day loaded. */
    drawdownPercentile: number | null;
    ulcerIndex: number;
    peakPrice: number;
    peakTime: string;
    barsSincePeak: number;
    cagr: number | null;
    sharpe: number | null;
    sortino: number | null;
    calmar: number | null;
    /** Percent of a full position that holds risk at a 15% volatility target. */
    volTargetWeight: number | null;
  };
  value: {
    /**
     * The regression itself, in log space against the bar index, so the chart
     * can draw the channel and the z-score from the same three numbers rather
     * than shipping six more arrays over a five-year window.
     */
    logFit: { slope: number; intercept: number; sigma: number } | null;
    slopeAnnual: number | null;
    rSquared: number | null;
    sigmaPercent: number | null;
    zScore: number | null;
    zPercentile: number | null;
    halfLifeDays: number | null;
    midline: number | null;
    upper1: number | null;
    lower1: number | null;
    upper2: number | null;
    lower2: number | null;
    longTermReturn: number | null;
    rsi14: number | null;
  };
  verdict: {
    score: number;
    bias: VerdictBias;
    label: string;
    trendScore: number;
    valueScore: number;
    riskScore: number;
    reasons: string[];
  };
};

/**
 * Per-bar overlays, aligned index-for-index with `candles` -- so no timestamp
 * is repeated eleven times over a five-year window. `null` is a warm-up gap.
 */
export type MarketOverlays = {
  sma50: Array<number | null>;
  sma200: Array<number | null>;
  /** Annualised realised volatility, 60-day window. */
  volatility: Array<number | null>;
  /** Percent below the running peak of everything loaded. */
  drawdown: number[];
  crosses: Array<{ time: string; type: "golden" | "death" }>;
};

export type MarketData = {
  symbol: string;
  name: string;
  type: AssetType;
  currency: string;
  exchange: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  rangeChange: number;
  range: MarketRange;
  rangeLabel: string;
  previousTop: number;
  drawdownPercent: number;
  drawdownRange: DrawdownRange;
  drawdownLabel: string;
  candles: Candle[];
  volume: VolumePoint[];
  analytics: MarketAnalytics;
  /** Only present when the caller asks for them; a table does not need them. */
  overlays?: MarketOverlays;
  marketTime: string | null;
  source: string;
};
