"use client";

import { currencyFormat, percentFormat } from "@/lib/format";
import { CDC_FAST, CDC_SLOW, REGRESSION_DEVIATIONS, cdcActionZone, cdcZoneCopy, chartSeries, regressionAt, regressionTrend } from "@/lib/indicators";
import type { ChartView, MarketData, MarketSignal, TrendRegime, VerdictBias } from "@/types/market";

export const chartViews: Array<{ value: ChartView; label: string; tag: string }> = [
  { value: "summary", label: "Summary", tag: "Regression trend + CDC ActionZone" },
  { value: "trend", label: "Trend", tag: "200-day average + momentum" },
  { value: "value", label: "Value", tag: "Distance from the fitted trend" }
];

const regimeCopy: Record<TrendRegime, { label: string; tone: string; note: string }> = {
  uptrend: {
    label: "Uptrend",
    tone: "text-mint-signal",
    note: "Above the 200-day average with positive twelve-month momentum. Both filters agree: hold or add."
  },
  recovery: {
    label: "Recovery",
    tone: "text-cyan-signal",
    note: "Back above the 200-day average, but the year is still down. Trend repairing, not yet confirmed."
  },
  pullback: {
    label: "Pullback",
    tone: "text-amber-signal",
    note: "Below the 200-day average while the year is still up. Either a dip inside an uptrend or the start of a break."
  },
  downtrend: {
    label: "Downtrend",
    tone: "text-rose-signal",
    note: "Below the 200-day average with negative twelve-month momentum. The regime filter says stand aside."
  }
};

const biasTone: Record<VerdictBias, string> = {
  accumulate: "text-mint-signal",
  add: "text-cyan-signal",
  hold: "text-slate-200",
  trim: "text-amber-signal",
  avoid: "text-rose-signal"
};

function signedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return percentFormat(value);
}

function plainPercent(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(digits)}%`;
}

function ratio(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(2);
}

function sessions(count: number) {
  const magnitude = Math.abs(count);
  return `${magnitude} session${magnitude === 1 ? "" : "s"}`;
}

/**
 * The three lenses weighted into one number. Deliberately simple and stated as
 * such: a weighted read of the evidence on screen, not a backtested strategy.
 */
export function MarketVerdict({ data }: { data: MarketData }) {
  const { verdict } = data.analytics;
  const offset = (verdict.score + 1) / 2;

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Composite read</p>
          <h2 className={`text-3xl font-black ${biasTone[verdict.bias]}`}>{verdict.label}</h2>
        </div>
        <strong className={`text-2xl font-black ${biasTone[verdict.bias]}`}>
          {verdict.score >= 0 ? "+" : ""}
          {verdict.score.toFixed(2)}
        </strong>
      </div>

      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-gradient-to-r from-rose-signal/60 via-slate-600/60 to-mint-signal/60">
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.7)]"
          style={{ left: `${Math.min(Math.max(offset, 0), 1) * 100}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <span>Trend {verdict.trendScore >= 0 ? "+" : ""}{verdict.trendScore.toFixed(2)} &middot; 45%</span>
        <span>Value {verdict.valueScore >= 0 ? "+" : ""}{verdict.valueScore.toFixed(2)} &middot; 35%</span>
        <span>Risk {verdict.riskScore >= 0 ? "+" : ""}{verdict.riskScore.toFixed(2)} &middot; 20%</span>
      </div>

      <ul className="mt-4 grid gap-2 border-t border-white/10 pt-4 text-sm text-slate-300">
        {verdict.reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span aria-hidden="true" className="text-slate-600">&bull;</span>
            {reason}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">
        A weighted read of trend, value and risk, not a backtested strategy. Nothing here sees your cost basis, your
        tax year, or anything outside this price series.
      </p>
    </section>
  );
}

/**
 * One table cell that answers "what do the three lenses say about this row".
 * The label carries the bias, the line under it carries the two numbers that
 * produced it, so the cell is auditable rather than oracular.
 */
export function SignalCell({ signal }: { signal: MarketSignal }) {
  return (
    <span className="block">
      <strong className={`block font-black ${biasTone[signal.bias]}`}>{signal.label}</strong>
      <small className="text-slate-500">
        {regimeCopy[signal.regime].label} · 200d {signedPercent(signal.priceVsSma200)}
        {signal.zScore === null ? "" : ` · ${signal.zScore >= 0 ? "+" : ""}${signal.zScore.toFixed(1)}σ`}
      </small>
    </span>
  );
}

export function ChartViewSwitch({
  view,
  onChange,
  className = ""
}: {
  view: ChartView;
  onChange: (view: ChartView) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-1 ${className}`}>
      {chartViews.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          title={item.tag}
          className={`rounded-xl px-3 py-2 text-sm font-black transition ${
            view === item.value ? "bg-cyan-signal text-[#05110e]" : "text-slate-300 hover:text-white"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function MarketLensPanel({ data, view }: { data: MarketData; view: ChartView }) {
  const { trend, value } = data.analytics;
  const currency = data.currency;

  if (view === "trend") {
    const regime = regimeCopy[trend.regime];

    return (
      <Lens
        title="Trend"
        subtitle="Time-series momentum"
        headline={regime.label}
        headlineTone={regime.tone}
        note={regime.note}
        howTo="Hold while price sits above a rising 200-day average and twelve-month momentum is positive; cut when both fail. The 50/200 cross is the slow confirmation, not the trigger."
        stats={[
          { label: "vs 200-day", value: signedPercent(trend.priceVsSma200), tone: tone(trend.priceVsSma200) },
          { label: "200-day slope", value: signedPercent(trend.sma200Slope), tone: tone(trend.sma200Slope), note: "annualised" },
          { label: "vs 50-day", value: signedPercent(trend.priceVsSma50), tone: tone(trend.priceVsSma50) },
          {
            label: trend.barsAboveSma200 >= 0 ? "Above 200-day" : "Below 200-day",
            value: sessions(trend.barsAboveSma200),
            tone: trend.barsAboveSma200 >= 0 ? "text-mint-signal" : "text-rose-signal"
          },
          { label: "12-1 momentum", value: signedPercent(trend.momentum.m12x1), tone: tone(trend.momentum.m12x1), note: "year, last month dropped" },
          { label: "12 months", value: signedPercent(trend.momentum.m12), tone: tone(trend.momentum.m12) },
          { label: "6 months", value: signedPercent(trend.momentum.m6), tone: tone(trend.momentum.m6) },
          { label: "3 months", value: signedPercent(trend.momentum.m3), tone: tone(trend.momentum.m3) },
          { label: "1 month", value: signedPercent(trend.momentum.m1), tone: tone(trend.momentum.m1) },
          {
            label: "Last 50/200 cross",
            value: trend.lastCross ? (trend.lastCross.type === "golden" ? "Golden" : "Death") : "none loaded",
            tone: trend.lastCross?.type === "golden" ? "text-mint-signal" : trend.lastCross ? "text-rose-signal" : "text-slate-400",
            note: trend.lastCross ? `${trend.lastCross.time} · ${sessions(trend.lastCross.barsSince)} ago` : undefined
          },
          { label: "200-day average", value: trend.sma200 === null ? "n/a" : currencyFormat(trend.sma200, currency) },
          { label: "50-day average", value: trend.sma50 === null ? "n/a" : currencyFormat(trend.sma50, currency) }
        ]}
      />
    );
  }

  if (view === "summary") return <SummaryLens data={data} />;

  const zone =
    value.zScore === null
      ? "No fit"
      : value.zScore <= -2
        ? "Deep value"
        : value.zScore <= -1
          ? "Cheap vs trend"
          : value.zScore < 1
            ? "At trend"
            : value.zScore < 2
              ? "Extended"
              : "Stretched";

  return (
    <Lens
      title="Value"
      subtitle="Distance from the fitted log trend"
      headline={value.zScore === null ? "n/a" : `${value.zScore >= 0 ? "+" : ""}${value.zScore.toFixed(2)} sigma`}
      headlineTone={value.zScore === null ? "text-slate-400" : value.zScore > 1 ? "text-rose-signal" : value.zScore < -1 ? "text-mint-signal" : "text-slate-200"}
      note={`${zone}. The channel is a least-squares fit of log price over the ${data.rangeLabel} on screen, so it moves as the window moves.`}
      howTo="Accumulate at -1 sigma or lower, trim at +2 sigma -- but only with the trend lens agreeing. A cheap z-score inside a downtrend is a falling knife, and r-squared tells you whether a straight trend line describes this series at all."
      stats={[
        { label: "Zone", value: zone },
        { label: "z percentile", value: plainPercent(value.zPercentile, 0), note: "of this window" },
        { label: "Trend slope", value: signedPercent(value.slopeAnnual), tone: tone(value.slopeAnnual), note: "annualised" },
        { label: "Fit quality", value: value.rSquared === null ? "n/a" : value.rSquared.toFixed(2), note: "r-squared of the log fit" },
        { label: "Sigma", value: plainPercent(value.sigmaPercent), note: "one standard error, in price" },
        {
          label: "Half-life",
          value: value.halfLifeDays === null ? "no reversion" : `${value.halfLifeDays.toFixed(0)} sessions`,
          note: "to close half the gap"
        },
        { label: "+2 sigma", value: value.upper2 === null ? "n/a" : currencyFormat(value.upper2, currency), tone: "text-rose-signal" },
        { label: "Trend line", value: value.midline === null ? "n/a" : currencyFormat(value.midline, currency) },
        { label: "-1 sigma", value: value.lower1 === null ? "n/a" : currencyFormat(value.lower1, currency), tone: "text-mint-signal" },
        { label: "-2 sigma", value: value.lower2 === null ? "n/a" : currencyFormat(value.lower2, currency), tone: "text-mint-signal" },
        { label: "RSI 14", value: value.rsi14 === null ? "n/a" : value.rsi14.toFixed(0) },
        { label: "Loaded history", value: signedPercent(value.longTermReturn), tone: tone(value.longTermReturn), note: `since ${data.analytics.historyFrom}` }
      ]}
    />
  );
}

/**
 * The default lens: where the window's high-to-low (or low-to-high) move is
 * heading, what CDC ActionZone says about today's bar, and the risk figures
 * that used to have a lens of their own.
 */
function SummaryLens({ data }: { data: MarketData }) {
  const { risk } = data.analytics;
  const currency = data.currency;
  const { candles, windowStart } = chartSeries(data);
  const cdc = cdcActionZone(candles);
  const windowBars = candles.slice(windowStart);
  const trend = regressionTrend(windowBars);
  const lastIndex = candles.length - 1;
  const zone = cdc.zones[lastIndex];
  const zoneCopy = zone ? cdcZoneCopy[zone] : null;
  const lastSignal = cdc.signals.at(-1);
  const last = windowBars.at(-1);

  // The line carried forward to the last bar, and how far today's close sits from it.
  const projected = trend && last ? regressionAt(trend, windowBars.length - 1) : null;
  const deviation = trend && last && projected !== null && trend.sigma ? (last.close - projected) / trend.sigma : null;

  return (
    <Lens
      title="Summary"
      subtitle={`CDC ActionZone · regression over ${data.rangeLabel}`}
      headline={zoneCopy?.label ?? "Not enough bars"}
      headlineTone={zone === "green" ? "text-mint-signal" : zone === "red" ? "text-rose-signal" : zone === "yellow" || zone === "orange" ? "text-amber-signal" : zone ? "text-cyan-signal" : "text-slate-400"}
      note={
        `${zoneCopy?.note ?? ""} ` +
        (trend
          ? `Over the ${data.rangeLabel}, price ran ${trend.direction === "high-to-low" ? "from its high down to its low" : "from its low up to its high"} (${trend.startTime} -> ${trend.endTime}); the regression through those closes moved ${percentFormat(trend.changePercent)}.`
          : "Too few bars between the high and the low to fit a trend.")
      }
      howTo={`CDC ActionZone (EMA ${CDC_FAST}/${CDC_SLOW} on the close): buy on the first green bar after a bearish run, sell on the first red bar after a bullish one; yellow and orange are the warnings in between. The regression trend is fitted once, to the range you picked, and does not move when you zoom: price far outside its +/-${REGRESSION_DEVIATIONS} std dev edges has broken the move.`}
      stats={[
        {
          label: "Last CDC signal",
          value: lastSignal ? lastSignal.type.toUpperCase() : "none loaded",
          tone: lastSignal?.type === "buy" ? "text-mint-signal" : lastSignal ? "text-rose-signal" : "text-slate-400",
          note: lastSignal ? `${lastSignal.time} · ${sessions(lastIndex - lastSignal.index)} ago` : undefined
        },
        {
          label: `EMA ${CDC_FAST} / ${CDC_SLOW}`,
          value: `${currencyFormat(cdc.fast[lastIndex] ?? 0, currency)}`,
          note: `slow ${currencyFormat(cdc.slow[lastIndex] ?? 0, currency)} · ${cdc.fast[lastIndex] > cdc.slow[lastIndex] ? "bullish" : "bearish"}`,
          tone: cdc.fast[lastIndex] > cdc.slow[lastIndex] ? "text-mint-signal" : "text-rose-signal"
        },
        {
          label: "Regression move",
          value: trend ? percentFormat(trend.changePercent) : "n/a",
          tone: tone(trend?.changePercent ?? null),
          note: trend ? `${trend.direction === "high-to-low" ? "high -> low" : "low -> high"}, ${trend.bars} bars` : undefined
        },
        {
          label: "Pearson's R",
          value: trend ? trend.pearsonR.toFixed(2) : "n/a",
          note: "how straight the move was; |R| near 1 is clean"
        },
        {
          label: "Today vs extended line",
          value: deviation === null ? "n/a" : `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)} std dev`,
          tone: deviation === null ? "text-slate-400" : Math.abs(deviation) > REGRESSION_DEVIATIONS ? "text-amber-signal" : "text-slate-200",
          note: projected === null ? undefined : `line at ${currencyFormat(projected, currency)}`
        },
        {
          label: "Window high / low",
          value: trend ? currencyFormat(trend.high.price, currency) : "n/a",
          note: trend ? `low ${currencyFormat(trend.low.price, currency)}` : undefined
        },
        { label: "Drawdown", value: plainPercent(risk.drawdown, 1), tone: "text-amber-signal", note: `from the ${risk.peakTime} peak` },
        { label: "Worst drawdown", value: plainPercent(risk.maxDrawdown, 1), tone: "text-rose-signal", note: "loaded history" },
        { label: "Volatility 60d", value: plainPercent(risk.vol60), note: `annualised · ${plainPercent(risk.volPercentile, 0)} percentile` },
        {
          label: "Size at 15% target",
          value: risk.volTargetWeight === null ? "n/a" : `${risk.volTargetWeight.toFixed(0)}%`,
          note: "of a full position",
          tone: "text-cyan-signal"
        },
        { label: "ATR", value: plainPercent(risk.atrPercent), note: "14-day, share of price" },
        { label: "Sharpe / CAGR", value: `${ratio(risk.sharpe)} / ${plainPercent(risk.cagr)}`, note: "loaded history" }
      ]}
    />
  );
}

type Stat = { label: string; value: string; note?: string; tone?: string };

function Lens({
  title,
  subtitle,
  headline,
  headlineTone,
  note,
  howTo,
  stats
}: {
  title: string;
  subtitle: string;
  headline: string;
  headlineTone: string;
  note: string;
  howTo: string;
  stats: Stat[];
}) {
  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-5">
      <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
        {title} &middot; {subtitle}
      </p>
      <h2 className={`text-3xl font-black ${headlineTone}`}>{headline}</h2>
      <p className="mt-2 text-sm text-slate-300">{note}</p>

      <div className="mt-4 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[.045] px-3 py-2">
            <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500">{stat.label}</span>
            <strong className={`mt-0.5 block text-lg font-black ${stat.tone || "text-white"}`}>{stat.value}</strong>
            {stat.note && <span className="block text-[11px] text-slate-500">{stat.note}</span>}
          </div>
        ))}
      </div>

      <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-400">
        <strong className="text-slate-300">How it is traded: </strong>
        {howTo}
      </p>
    </section>
  );
}

function tone(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "text-slate-400";
  return value >= 0 ? "text-mint-signal" : "text-rose-signal";
}
