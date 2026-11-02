"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { drawdownRanges, fallbackMarketData, marketRanges } from "@/lib/market";
import { currencyFormat, percentFormat } from "@/lib/format";
import { fetchMarketWithRetry, isAbortError } from "@/lib/market-client";
import type { ChartView, DrawdownRange, MarketData, MarketRange } from "@/types/market";
import { MarketChart } from "./market-chart";
import { ChartViewSwitch, MarketLensPanel, MarketVerdict, chartViews } from "./market-analysis";

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
  const [view, setView] = useState<ChartView>("summary");
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>("1y");
  const [data, setData] = useState<MarketData | null>(null);
  const [chartType, setChartType] = useState<"candles" | "area">("candles");
  const [events, setEvents] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const activeView = chartViews.find((item) => item.value === view)!;

  function addEvent(title: string, body: string) {
    setEvents((current) => [{ id: crypto.randomUUID(), title, body }, ...current].slice(0, 10));
  }

  async function loadMarket(nextSymbol = symbol, nextRange = range, nextDrawdownRange = drawdownRange) {
    const cleanSymbol = nextSymbol.trim().toUpperCase() || "AAPL";
    // A newer pick wins: the previous request, retries included, is dropped.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setSymbol(cleanSymbol);

    try {
      const payload = await fetchMarketWithRetry(
        { symbol: cleanSymbol, range: nextRange, drawdownRange: nextDrawdownRange, overlays: true },
        {
          signal: controller.signal,
          onRetry: (attempt, total) => addEvent("Retrying", `${cleanSymbol}: provider did not answer, attempt ${attempt + 1} of ${total + 1}.`)
        }
      );
      setData(payload);
      setSymbol(payload.symbol);
      addEvent("Market loaded", `${payload.symbol} over ${payload.rangeLabel}, ${payload.analytics.historyBars} bars read.`);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      const fallback = fallbackMarketData(cleanSymbol, nextRange, nextDrawdownRange, true);
      setData(fallback);
      addEvent("Offline fallback", `${error instanceof Error ? error.message : "Provider unreachable"} -- still failing after retries, showing demo data.`);
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }

  async function loadSavedWatchlist() {
    try {
      const response = await fetch("/api/watchlist/my-watchlist");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the watchlist");
      setWatchlist((payload as { symbols: string[] }).symbols);
    } catch (error) {
      addEvent("Watchlist load failed", error instanceof Error ? error.message : "Unable to load the watchlist.");
    } finally {
      setWatchlistLoaded(true);
    }
  }

  useEffect(() => {
    loadMarket("AAPL", "1y", "1y");
    loadSavedWatchlist();
    return () => requestRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A mouse wheel scrolls the symbol strip sideways; it has no vertical room.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    function onWheel(event: WheelEvent) {
      if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    }

    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active symbol in view when it is picked from somewhere else.
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [data?.symbol, watchlist]);

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

  const inWatchlist = Boolean(data && watchlist.includes(data.symbol));
  const changeTone = data && data.changePercent > 0 ? "text-mint-signal" : data && data.changePercent < 0 ? "text-rose-signal" : "text-slate-400";
  const trend = data?.analytics.trend;
  const risk = data?.analytics.risk;
  const value = data?.analytics.value;

  return (
    <div className={loading ? "animate-glow" : ""}>
      <section className="glass-panel mb-4 rounded-3xl p-3">
        <form onSubmit={submitSymbol} className="grid grid-cols-[1fr_56px] gap-2 md:grid-cols-[1fr_150px_56px]">
          <label className="field-shell col-span-2 grid gap-1 rounded-2xl px-4 py-3 md:col-span-1">
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
          <label className="field-shell grid min-w-0 gap-1 rounded-2xl px-4 py-3">
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
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={saveCurrentToWatchlist}
            disabled={!data || watchlistSaving || inWatchlist}
            title={inWatchlist ? `${data?.symbol} is on your watchlist` : "Add the current symbol to your watchlist"}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-lg font-black text-cyan-signal transition hover:border-cyan-signal/40 disabled:cursor-default disabled:text-slate-500 sm:size-10"
            aria-label="Add current symbol to watchlist"
          >
            {watchlistSaving ? "…" : inWatchlist ? "✓" : "+"}
          </button>
          <div
            ref={stripRef}
            className="-my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Watchlist symbols"
          >
            {!watchlistLoaded && <span className="px-3 py-2 text-sm text-slate-500">Loading watchlist...</span>}
            {watchlistLoaded && !watchlist.length && <span className="px-3 py-2 text-sm text-slate-500">Watchlist is empty.</span>}
            {watchlist.map((item) => {
              const active = item === data?.symbol;
              return (
                <button
                  key={item}
                  type="button"
                  data-active={active}
                  onClick={() => loadMarket(item, range, drawdownRange)}
                  className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition sm:px-4 sm:py-2 sm:text-base ${
                    active
                      ? "border-cyan-signal/60 bg-cyan-signal/15 font-black text-white"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-signal/40 hover:text-white"
                  }`}
                >
                  {symbolLabel(item)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-[minmax(460px,2.3fr)_repeat(3,minmax(160px,1fr))]">
        <article className="glass-panel animate-rise-in col-span-full grid gap-4 overflow-hidden rounded-3xl p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end lg:col-span-1">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Watching</p>
            <h1 className="break-words font-serif text-4xl leading-none sm:text-5xl md:text-6xl">{data?.name || "Loading"}</h1>
            <p className="mt-3 text-slate-300">{data ? `${data.symbol} · ${data.type} · ${data.currency}${data.exchange ? ` · ${data.exchange}` : ""}` : "Awaiting market"}</p>
          </div>
          <div className="text-left md:text-right">
            <strong className="block whitespace-nowrap text-4xl font-black sm:text-5xl">{data ? currencyFormat(data.price, data.currency) : "$0.00"}</strong>
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
          className="max-sm:col-span-2"
          tone={!value?.zScore ? "text-white" : value.zScore > 1 ? "text-rose-signal" : value.zScore < -1 ? "text-mint-signal" : "text-white"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="grid content-start gap-4">
          <section className="glass-panel overflow-hidden rounded-3xl">
            <div className="flex flex-col gap-3 p-4 sm:gap-4 sm:p-5 md:flex-row md:items-center md:justify-between">
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
                <div className="inline-flex overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-1">
                  {marketRanges.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        setRange(item.value);
                        loadMarket(symbol, item.value, drawdownRange);
                      }}
                      title={item.label}
                      className={`rounded-xl px-3 py-2 text-sm font-black transition ${
                        range === item.value ? "bg-white text-[#05110e]" : "text-slate-300 hover:text-white"
                      }`}
                    >
                      {item.short}
                    </button>
                  ))}
                </div>
                <ChartViewSwitch view={view} onChange={setView} />
                <button onClick={() => setChartType("candles")} className={chipClass(chartType === "candles")}>Candles</button>
                <button onClick={() => setChartType("area")} className={chipClass(chartType === "area")}>Line</button>
                <button onClick={() => loadMarket(symbol, range, drawdownRange)} className={chipClass(false)}>Refresh</button>
              </div>
            </div>
            <MarketChart data={data} chartType={chartType} view={view} />
            <div className="flex flex-col gap-1 border-t border-white/10 px-4 py-3 text-xs sm:gap-2 sm:px-5 sm:py-4 sm:text-sm text-slate-400 md:flex-row md:justify-between">
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

          <section className="glass-panel rounded-3xl p-4 sm:p-5">
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

function Metric({ title, value, note, tone = "text-white", className = "" }: { title: string; value: string; note: string; tone?: string; className?: string }) {
  return (
    <article className={`glass-panel animate-rise-in relative min-w-0 overflow-hidden rounded-3xl p-4 before:absolute before:-bottom-12 before:-right-8 before:h-32 before:w-32 before:rounded-full before:border before:border-cyan-signal/20 before:content-[''] sm:min-h-36 sm:p-6 ${className}`}>
      <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400 sm:mb-3">{title}</p>
      <strong className={`block truncate text-2xl font-black sm:text-3xl ${tone}`}>{value}</strong>
      <span className="text-sm text-slate-400 sm:text-base">{note}</span>
    </article>
  );
}

function symbolLabel(symbol: string) {
  return symbol === "GC=F" ? "Gold" : symbol === "BTC-USD" ? "BTC" : symbol;
}

function chipClass(active: boolean) {
  return `rounded-full border px-4 py-2 transition ${
    active ? "border-cyan-signal/50 text-white" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
  }`;
}
