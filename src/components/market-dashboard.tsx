"use client";

import { FormEvent, useEffect, useState } from "react";
import { drawdownRanges, fallbackMarketData, marketRanges } from "@/lib/market";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { ChartView, DrawdownRange, MarketData, MarketRange } from "@/types/market";
import { MarketChart } from "./market-chart";
import { ChartViewSwitch, MarketLensPanel, MarketVerdict, chartViews } from "./market-analysis";

const quickSymbols = ["AAPL", "MSFT", "GC=F", "BTC-USD", "^GSPC", "^IXIC"];

type EventLog = {
  id: string;
  title: string;
  body: string;
};

type WatchlistWriteResponse = {
  symbol: string;
  symbols: string[];
};

export function MarketDashboard() {
  const [symbol, setSymbol] = useState("AAPL");
  const [range, setRange] = useState<MarketRange>("1y");
  const [view, setView] = useState<ChartView>("trend");
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>("1y");
  const [data, setData] = useState<MarketData | null>(null);
  const [chartType, setChartType] = useState<"candles" | "area">("area");
  const [events, setEvents] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [watchlist, setWatchlist] = useState(quickSymbols);
  const [watchlistSaving, setWatchlistSaving] = useState(false);

  const activeView = chartViews.find((item) => item.value === view)!;

  function addEvent(title: string, body: string) {
    setEvents((current) => [{ id: crypto.randomUUID(), title, body }, ...current].slice(0, 10));
  }

  async function loadMarket(nextSymbol = symbol, nextRange = range, nextDrawdownRange = drawdownRange) {
    const cleanSymbol = nextSymbol.trim().toUpperCase() || "AAPL";
    setLoading(true);
    setSymbol(cleanSymbol);

    try {
      const url = new URL("/api/market", window.location.origin);
      url.searchParams.set("symbol", cleanSymbol);
      url.searchParams.set("range", nextRange);
      url.searchParams.set("interval", "1d");
      url.searchParams.set("drawdownRange", nextDrawdownRange);
      url.searchParams.set("overlays", "1");
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to fetch market data");
      setData(payload);
      setSymbol(payload.symbol);
      addEvent("Market loaded", `${payload.symbol} over ${payload.rangeLabel}, ${payload.analytics.historyBars} bars read.`);
    } catch (error) {
      const fallback = fallbackMarketData(cleanSymbol, nextRange, nextDrawdownRange, true);
      setData(fallback);
      addEvent("Offline fallback", error instanceof Error ? error.message : "Using demo data.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedWatchlist() {
    try {
      const response = await fetch("/api/watchlist/my-watchlist");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the watchlist");
      setWatchlist((payload as { symbols: string[] }).symbols);
    } catch (error) {
      addEvent("Watchlist load failed", error instanceof Error ? error.message : "Using default symbols.");
    }
  }

  useEffect(() => {
    loadMarket("AAPL", "1y", "1y");
    loadSavedWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadMarket(symbol, range, drawdownRange);
  }

  async function saveCurrentToWatchlist() {
    if (!data) return;
    setWatchlistSaving(true);

    try {
      const response = await fetch("/api/watchlist/my-watchlist", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          symbol: data.symbol
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the watchlist");

      const { symbols } = payload as WatchlistWriteResponse;
      setWatchlist(symbols);
      addEvent("Watchlist saved", `${data.symbol} saved to your watchlist.`);
    } catch (error) {
      addEvent("Watchlist save failed", error instanceof Error ? error.message : "Unable to save the watchlist.");
    } finally {
      setWatchlistSaving(false);
    }
  }

  const changeTone = data && data.changePercent > 0 ? "text-mint-signal" : data && data.changePercent < 0 ? "text-rose-signal" : "text-slate-400";
  const trend = data?.analytics.trend;
  const risk = data?.analytics.risk;
  const value = data?.analytics.value;

  return (
    <div className={loading ? "animate-glow" : ""}>
      <section className="glass-panel mb-4 rounded-3xl p-3">
        <form onSubmit={submitSymbol} className="grid gap-2 md:grid-cols-[1fr_110px_150px_56px]">
          <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Symbol</span>
            <input
              className="min-w-0 bg-transparent text-xl text-white outline-none"
              id="symbol"
              name="symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              aria-label="Enter stock, gold, bitcoin, or index symbol"
            />
          </label>
          <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Range</span>
            <select
              className="bg-transparent text-lg text-white outline-none"
              id="range"
              name="range"
              value={range}
              onChange={(event) => {
                const nextRange = event.target.value as MarketRange;
                setRange(nextRange);
                loadMarket(symbol, nextRange, drawdownRange);
              }}
              aria-label="Chart range"
            >
              {marketRanges.map((item) => (
                <option className="bg-panel" key={item.value} value={item.value}>
                  {item.short}
                </option>
              ))}
            </select>
          </label>
          <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Top window</span>
            <select
              className="bg-transparent text-lg text-white outline-none"
              id="drawdown-range"
              name="drawdownRange"
              value={drawdownRange}
              onChange={(event) => {
                const nextRange = event.target.value as DrawdownRange;
                setDrawdownRange(nextRange);
                loadMarket(symbol, range, nextRange);
              }}
              aria-label="Window for the previous top"
            >
              {drawdownRanges.map((item) => (
                <option className="bg-panel" key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-2xl bg-gradient-to-br from-mint-signal to-cyan-signal text-2xl font-black text-[#021011]" aria-label="Load symbol">
            ↗
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {quickSymbols.map((item) => (
            <button
              key={item}
              onClick={() => loadMarket(item, range, drawdownRange)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-slate-300 transition hover:border-cyan-signal/40 hover:text-white"
            >
              {item === "GC=F" ? "Gold" : item === "BTC-USD" ? "BTC" : item}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4 grid gap-4 lg:grid-cols-[minmax(460px,2.3fr)_repeat(3,minmax(160px,1fr))]">
        <article className="glass-panel animate-rise-in grid gap-4 overflow-hidden rounded-3xl p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Watching</p>
            <h1 className="break-words font-serif text-5xl leading-none md:text-6xl">{data?.name || "Loading"}</h1>
            <p className="mt-3 text-slate-300">{data ? `${data.symbol} · ${data.type} · ${data.currency}${data.exchange ? ` · ${data.exchange}` : ""}` : "Awaiting market"}</p>
          </div>
          <div className="text-left md:text-right">
            <strong className="block whitespace-nowrap text-5xl font-black">{data ? currencyFormat(data.price, data.currency) : "$0.00"}</strong>
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-lg font-black ${changeTone} bg-white/8`}>
              {data ? `${currencyFormat(data.change, data.currency)} ${percentFormat(data.changePercent)}` : "0.00%"}
            </span>
          </div>
        </article>
        <Metric
          title="Trend"
          value={trend ? trendLabels[trend.regime] : "--"}
          note={trend ? `${percentFormat(trend.priceVsSma200 ?? 0)} vs the 200-day average` : "regime filter"}
          tone={trend ? trendTones[trend.regime] : "text-white"}
        />
        <Metric
          title="Drawdown"
          value={risk ? percentFormat(risk.drawdown) : "0.00%"}
          note={risk ? `worst ${percentFormat(risk.maxDrawdown)} since ${data?.analytics.historyFrom}` : "from the running peak"}
          tone="text-amber-signal"
        />
        <Metric
          title="Vs Trend"
          value={value?.zScore === null || !value ? "n/a" : `${value.zScore >= 0 ? "+" : ""}${value.zScore.toFixed(2)}σ`}
          note={data ? `${data.rangeLabel} fit · range move ${percentFormat(data.rangeChange)}` : "regression channel"}
          tone={!value?.zScore ? "text-white" : value.zScore > 1 ? "text-rose-signal" : value.zScore < -1 ? "text-mint-signal" : "text-white"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="grid content-start gap-4">
          <section className="glass-panel overflow-hidden rounded-3xl">
            <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
                  {data?.symbol || "AAPL"} · {data?.rangeLabel || "1 year"}
                </p>
                <h2 className="text-xl font-black">
                  {activeView.label}
                  <span className="ml-2 text-sm font-bold text-slate-400">{activeView.tag}</span>
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ChartViewSwitch view={view} onChange={setView} />
                <button onClick={() => setChartType("candles")} className={chipClass(chartType === "candles")}>Candles</button>
                <button onClick={() => setChartType("area")} className={chipClass(chartType === "area")}>Line</button>
                <button onClick={() => loadMarket(symbol, range, drawdownRange)} className={chipClass(false)}>Refresh</button>
              </div>
            </div>
            <MarketChart data={data} chartType={chartType} view={view} />
            <div className="flex flex-col gap-2 border-t border-white/10 px-5 py-4 text-sm text-slate-400 md:flex-row md:justify-between">
              <span>Source: {data?.source || "loading"}</span>
              <span>
                {data ? `${data.analytics.bars} bars shown, ${data.analytics.historyBars} read for the averages` : "loading"}
              </span>
              <span>Last candle: {data?.marketTime || "loading"}</span>
            </div>
          </section>

          {data && <MarketLensPanel data={data} view={view} />}
        </div>

        <aside className="grid content-start gap-4">
          {data && <MarketVerdict data={data} />}

          <section className="glass-panel rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Watchlist</p>
                <h2 className="text-xl font-black">Markets</h2>
              </div>
              <button
                onClick={saveCurrentToWatchlist}
                disabled={!data || watchlistSaving}
                className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 text-2xl text-cyan-signal"
                title="Add current symbol"
              >
                {watchlistSaving ? "..." : "+"}
              </button>
            </div>
            <div className="grid max-h-72 gap-2 overflow-auto">
              {watchlist.map((item) => (
                <button key={item} onClick={() => loadMarket(item, range, drawdownRange)} className="flex min-h-14 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left">
                  <span>
                    <strong className="block">{item}</strong>
                    <small className="text-slate-400">{item === data?.symbol ? "active" : "watch"}</small>
                  </span>
                  <em className="not-italic text-mint-signal">{item === data?.symbol ? "●" : "↗"}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-3xl p-5">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Data log</p>
            <h2 className="mb-4 text-xl font-black">Activity</h2>
            <div className="grid max-h-80 gap-2 overflow-auto" aria-live="polite">
              {events.map((event) => (
                <article key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <strong className="block">{event.title}</strong>
                  <small className="text-slate-400">{event.body}</small>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

const trendLabels = {
  uptrend: "Uptrend",
  recovery: "Recovery",
  pullback: "Pullback",
  downtrend: "Downtrend"
} as const;

const trendTones = {
  uptrend: "text-mint-signal",
  recovery: "text-cyan-signal",
  pullback: "text-amber-signal",
  downtrend: "text-rose-signal"
} as const;

function Metric({ title, value, note, tone = "text-white" }: { title: string; value: string; note: string; tone?: string }) {
  return (
    <article className="glass-panel animate-rise-in relative min-h-36 overflow-hidden rounded-3xl p-6 before:absolute before:-bottom-12 before:-right-8 before:h-32 before:w-32 before:rounded-full before:border before:border-cyan-signal/20 before:content-['']">
      <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">{title}</p>
      <strong className={`block text-3xl font-black ${tone}`}>{value}</strong>
      <span className="text-slate-400">{note}</span>
    </article>
  );
}

function chipClass(active: boolean) {
  return `rounded-full border px-4 py-2 transition ${
    active ? "border-cyan-signal/50 text-white" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
  }`;
}
