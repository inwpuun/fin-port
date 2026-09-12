# Three ways to read a chart

The market page and every symbol chart in the app read the same daily price
series through three lenses. They were picked because each is (a) computable
from daily OHLCV alone, (b) documented in published work rather than trading
folklore, and (c) meaningful over six months to several years — which is the
horizon this app is for. Nothing here is a day-trading tool.

The three are deliberately independent. Trend says *which way*, risk says *how
much*, value says *how good the price is*. A signal that all three agree on is
rare and worth acting on; a signal only one of them likes usually is not.

| Lens | Question it answers | Core statistic |
| --- | --- | --- |
| **Trend** | Is this asset in an up regime? | Price vs the 200-day average, twelve-month momentum |
| **Risk** | How large a position can I carry, and is this a good moment? | Realised volatility, drawdown from peak |
| **Value** | Is the price stretched against its own trend? | Residual z-score from a log-linear fit |

---

## 1. Trend — time-series momentum

### What it is

Buy what has been going up over the past six to twelve months; step aside when
it turns down. Two forms of the same idea are combined:

- **A regime filter**: is price above its 200-day moving average? Faber's
  tactical allocation rule uses the 10-month average on monthly data, which is
  the same line at daily resolution.
- **Time-series momentum**: is the return over the past twelve months
  positive? The chart reports both the plain twelve-month return and the
  **12-1** form — twelve months ending one month ago — because the most recent
  month tends to reverse, which is why the momentum literature drops it.

### Evidence

- Moskowitz, Ooi & Pedersen, *Time Series Momentum*, Journal of Financial
  Economics, 2012 — the sign of the past twelve months predicts the next month
  across 58 futures markets over 25 years.
- Hurst, Ooi & Pedersen, *A Century of Evidence on Trend-Following Investing*,
  AQR / Journal of Portfolio Management, 2017 — the same effect back to 1880.
- Faber, *A Quantitative Approach to Tactical Asset Allocation*, 2007 — the
  10-month average rule, whose main contribution is cutting drawdowns rather
  than raising returns.
- Jegadeesh & Titman, 1993 — the original cross-sectional 12-1 momentum result.

### What the app computes

- `sma50`, `sma200`, and price as a percentage above or below each.
- **Slope of the 200-day average** over the last 63 sessions, annualised. A
  rising average is a different regime from a flat one at the same price.
- **Consecutive sessions** on one side of the 200-day average.
- Momentum over 1, 3, 6 and 12 months, plus 12-1.
- **50/200 crossings** ("golden" and "death" crosses), marked on the chart with
  the date and how long ago. These are slow confirmation, not a trigger: by the
  time a 50/200 cross prints, price has usually moved 10-20% already.
- A four-state regime label:

  | | 12-month momentum > 0 | 12-month momentum < 0 |
  | --- | --- | --- |
  | **Above 200-day** | Uptrend | Recovery |
  | **Below 200-day** | Pullback | Downtrend |

### How it is traded

Hold while price is above a rising 200-day average and twelve-month momentum is
positive. Reduce or exit when both fail. "Recovery" and "Pullback" are the
ambiguous states where the two filters disagree — the honest answer there is a
smaller position, not a bigger conviction.

### Where it fails

Trend following loses money in choppy, range-bound markets — many small losses
punctuated by a few large wins. It is late by construction at both ends: it
never buys the bottom and never sells the top. A 200-day average on an asset
that gaps (crypto over a weekend, a single stock on earnings) can be crossed and
re-crossed several times in a month.

---

## 2. Risk — drawdown and realised volatility

### What it is

Two facts that decide size and timing more reliably than any entry signal:

- **Realised volatility**: the standard deviation of daily log returns over a
  rolling window, annualised (multiplied by the square root of 252). Volatility
  clusters — today's volatility predicts tomorrow's far better than today's
  return predicts tomorrow's return. That makes it the one input you can size
  against.
- **The drawdown curve**: percent below the running peak, plotted through time
  as an "underwater" chart. Its distribution over years tells you what a normal
  bad patch looks like for *this* asset, which is the only useful reference for
  whether today's fall is ordinary or exceptional.

### Evidence

- Moreira & Muir, *Volatility-Managed Portfolios*, Journal of Finance, 2017 —
  scaling exposure inversely to recent volatility raises Sharpe ratios.
- Harvey, Hoyle, Korgaonkar, Rattray, Sargaison & van Hemert, *The Impact of
  Volatility Targeting*, Journal of Portfolio Management, 2018 — the mechanism
  works mainly by cutting the fat left tail, and works best for risk assets.
- Martin & McCann's **Ulcer index**, 1989 — drawdown depth *and* duration in one
  number, which max-drawdown alone hides.

### What the app computes

- Annualised volatility over 20, 60 and 252 sessions, the 60-day figure's
  **percentile against its own history**, and its median.
- **Position size at a 15% volatility target**: `15 / realised volatility`,
  capped at 200%. An asset running at 45% volatility gets a third of the size of
  one running at 15%, for the same risk contribution.
- Current drawdown, the peak it is measured from, and **how deep today ranks
  against every day loaded** — "deeper than 78% of days" is a far more useful
  entry statistic than "down 12%".
- Worst drawdown, Ulcer index, ATR as a percent of price.
- CAGR, Sharpe, Sortino and Calmar over the loaded history. No cash rate is
  subtracted, so these are gross ratios, not excess-return ratios.

### How it is traded

Let volatility set the size and the drawdown distribution set the timing. Add in
the deeper part of the drawdown distribution rather than at the high; de-risk
when volatility jumps into its top decile *and* the trend lens has already
broken. Volatility spikes alone are often the bottom, not the top — which is
exactly why this lens is not allowed to vote alone.

### Where it fails

Volatility targeting cuts exposure after a fall, so it locks in some of the
loss it is protecting against, and it can halve a position right before a
V-shaped recovery. Realised volatility says nothing about direction: a quiet
market can still be a terminally declining one.

---

## 3. Value — distance from the fitted trend

### What it is

Fit a straight line through **log** price against the bar index over the visible
window, by ordinary least squares. Log price, because a straight line in log
space is constant compound growth, which is the shape a growing asset actually
has. Then measure how far today sits from that line in units of the fit's own
standard error — a **z-score**. Bands are drawn at ±1σ and ±2σ.

This is the single-asset form of the residual z-score that statistical arbitrage
uses on a pair or a basket, and it is the mechanical version of "expensive
relative to its own trend".

### Evidence

- De Bondt & Thaler, *Does the Stock Market Overreact?*, Journal of Finance,
  1985 — long-horizon reversal: three-to-five-year losers subsequently beat
  winners.
- Asness, Moskowitz & Pedersen, *Value and Momentum Everywhere*, Journal of
  Finance, 2013 — value and momentum are negatively correlated and work better
  together than either alone. That is precisely why this lens sits next to the
  trend lens rather than replacing it.
- The **half-life** figure comes from the Ornstein-Uhlenbeck fit standard in
  pairs trading: regress the residual on its own lag, take `phi`, and report
  `-ln(2) / ln(phi)`. It answers "how many sessions has it historically taken
  to close half the gap to trend", and is reported as *no reversion* when `phi`
  falls outside 0 to 1 — i.e. when the residual is not mean reverting at all.

### What the app computes

- The fit's annualised slope (`exp(slope × 252) - 1`) and its **r-squared**.
- σ expressed as a percentage of price, and the ±1σ / ±2σ price levels.
- Today's z-score, its percentile within the window, and a zone label:
  deep value (≤ -2σ), cheap (≤ -1σ), at trend, extended (≥ +1σ), stretched (≥ +2σ).
- The mean-reversion half-life, RSI(14), and the total return over the loaded
  history as a long-term reversal reference.

### How it is traded

Accumulate at -1σ or lower, trim at +2σ — **but only with the trend lens
agreeing**. A cheap z-score inside a downtrend is a falling knife, which is the
single most common way this lens loses money. Check r-squared first: below
roughly 0.5 a straight trend line does not describe the series, and the z-score
built on it means correspondingly little.

### Where it fails

Two honest limitations:

1. **The fit moves with the window.** Change the range from 1Y to 5Y and the
   channel, slope and z-score all change, because they are statements about the
   stretch of history on screen. That is a feature for reading a chart and a
   trap for comparing two screenshots taken at different ranges.
2. **The fit is in-sample.** It uses every bar in the window, including today,
   so today's z-score is a *description* of where price sits in that window —
   not a signal you could have traded at the left edge of it. Backtesting this
   properly needs an expanding-window refit that only ever sees the past. The
   app does not do that, and the number should not be read as backtested edge.

---

## The composite

The panel headline weights the three lenses:

```
score = 0.45 × trend + 0.35 × value + 0.20 × risk
```

- `trend` = 0.55 × (% above the 200-day average, saturating at ±12%)
          + 0.45 × (12-1 momentum, saturating at ±25%)
- `value` = -z / 2, saturating at ±1 — cheap is positive
- `risk`  = (50 - volatility percentile) / 50 — quiet is positive

Bands: ≥ +0.35 accumulate, ≥ +0.10 add on weakness, ±0.10 hold, ≤ -0.10 trim,
≤ -0.35 stand aside.

The weights are judgement, not an optimisation: trend gets the most because it
has the strongest out-of-sample evidence over this horizon, risk gets the least
because it is a sizing input rather than a direction. **This is a weighted read
of the evidence on screen, not a backtested strategy**, and the panel lists the
five facts that produced it so the number can be argued with.

---

## What was deliberately left out

- **RSI, MACD, stochastics as primary signals.** Oscillators tuned for days
  say almost nothing about a six-month decision. RSI(14) is shown as a
  secondary reference in the value lens and given no weight in the composite.
- **Bollinger bands.** A 20-day band is a two-week statement. The regression
  channel is the same idea fitted over the horizon that matters here.
- **Chart patterns, Elliott waves, Fibonacci levels.** Not reproducible from
  the data, so not implementable, so not included.
- **Intraday and volume-profile work.** The data source is daily bars, and the
  intended holding period is quarters.
- **Alerts and browser notifications.** They were removed: an alert that only
  fires while a browser tab is open is not a monitoring system, and the metrics
  above are what the page is for.

## Data and warm-up

Every average and volatility figure needs bars from *before* the window to be
defined on its first bar, so each request loads about 14 extra months and then
shows only the range asked for. A six-month chart therefore opens with a
200-day average already drawn and twelve-month momentum already computed, and a
five-year chart pulls ten years from the provider. `analytics.historyBars` and
`analytics.bars` report both counts.

Drawdown is measured from the running peak of everything loaded, not just the
visible window, so the curve stays honest about a high set before the left edge
of the chart.

## Caveats

These are descriptive statistics over a single price series. They do not know
your cost basis, your tax position, your income, your other holdings, or
anything at all about the business behind the ticker. They are not advice, and
the composite is not a backtest.
