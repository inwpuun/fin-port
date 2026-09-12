/**
 * Sanity-check the three lenses without a browser.
 *
 *   npm run check:analytics          # synthetic series with known answers
 *   npm run check:analytics NVDA     # and then a live symbol at 6mo/1y/5y
 *
 * The synthetic cases are the real test: a noiseless series compounding at a
 * known rate must return that rate as the fitted slope, an r-squared of 1, a
 * z-score of 0 and no drawdown. If those drift, the math broke.
 */
import { analyseMarket } from "@/lib/analytics";
import { fetchMarketData } from "@/lib/market";
import type { Candle, MarketRange } from "@/types/market";

function synthetic(count: number, annualDrift: number, lateShock = 0) {
  const candles: Candle[] = [];
  const daily = Math.log(1 + annualDrift) / 252;

  for (let index = 0; index < count; index += 1) {
    const close = 100 * Math.exp(daily * index) * (index >= count - 20 ? 1 - lateShock : 1);
    candles.push({
      time: new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close
    });
  }

  return candles;
}

function report(label: string, expectations: Record<string, unknown>) {
  console.log(`\n--- ${label} ---`);
  for (const [key, value] of Object.entries(expectations)) {
    console.log(`  ${key.padEnd(22)} ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
}

const smooth = analyseMarket(synthetic(1300, 0.1), 1300 - 252);
report("noiseless, 10%/yr, one year shown (expect slope 10, r2 1, z 0, no drawdown)", {
  slopeAnnual: smooth.analytics.value.slopeAnnual,
  rSquared: smooth.analytics.value.rSquared,
  zScore: smooth.analytics.value.zScore,
  vol60: smooth.analytics.risk.vol60,
  drawdown: smooth.analytics.risk.drawdown,
  maxDrawdown: smooth.analytics.risk.maxDrawdown,
  priceVsSma200: smooth.analytics.trend.priceVsSma200,
  regime: smooth.analytics.trend.regime,
  momentum12: smooth.analytics.trend.momentum.m12,
  verdict: smooth.analytics.verdict.label,
  barsShown: smooth.analytics.bars,
  overlaysAligned: [smooth.overlays.sma200.length, smooth.overlays.drawdown.length],
  sma200OnFirstBar: smooth.overlays.sma200[0]
});

const shocked = analyseMarket(synthetic(1300, 0.1, 0.3), 1300 - 252);
report("same series, 30% drop over the last 20 bars (expect ~-30% drawdown, a death cross)", {
  drawdown: shocked.analytics.risk.drawdown,
  maxDrawdown: shocked.analytics.risk.maxDrawdown,
  peakTime: shocked.analytics.risk.peakTime,
  zScore: shocked.analytics.value.zScore,
  priceVsSma200: shocked.analytics.trend.priceVsSma200,
  regime: shocked.analytics.trend.regime,
  vol60: shocked.analytics.risk.vol60,
  sizeAt15Target: shocked.analytics.risk.volTargetWeight,
  verdict: shocked.analytics.verdict.label,
  crosses: shocked.overlays.crosses
});

const symbol = process.argv[2];
if (symbol) {
  for (const range of ["6mo", "1y", "5y"] as MarketRange[]) {
    const data = await fetchMarketData(symbol, range, "1d", "1y", true);
    report(`${data.symbol} ${range} via ${data.source}`, {
      barsShownRead: `${data.analytics.bars} / ${data.analytics.historyBars} from ${data.analytics.historyFrom}`,
      price: data.price,
      trend: `${data.analytics.trend.regime}, ${data.analytics.trend.priceVsSma200}% vs 200-day, slope ${data.analytics.trend.sma200Slope}%`,
      momentum: data.analytics.trend.momentum,
      risk: {
        drawdown: data.analytics.risk.drawdown,
        worst: data.analytics.risk.maxDrawdown,
        depthPercentile: data.analytics.risk.drawdownPercentile,
        vol60: data.analytics.risk.vol60,
        volPercentile: data.analytics.risk.volPercentile,
        sharpe: data.analytics.risk.sharpe,
        size: data.analytics.risk.volTargetWeight
      },
      value: {
        z: data.analytics.value.zScore,
        slopeAnnual: data.analytics.value.slopeAnnual,
        rSquared: data.analytics.value.rSquared,
        halfLifeDays: data.analytics.value.halfLifeDays
      },
      verdict: `${data.analytics.verdict.label} (${data.analytics.verdict.score})`,
      // Every overlay must already be defined on the first visible bar; a null
      // here means the warm-up window is too short.
      firstBarDefined: {
        sma200: data.overlays!.sma200[0],
        volatility: data.overlays!.volatility[0],
        logFit: Boolean(data.analytics.value.logFit)
      },
      payloadKB: Math.round(JSON.stringify(data).length / 1024)
    });
  }
}
