"use client";

import { useCallback, useEffect, useState } from "react";
import { fallbackMarketData, marketRanges } from "@/lib/market";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { ChartView, DrawdownRange, MarketData, MarketRange } from "@/types/market";
import { MarketChart } from "./market-chart";
import { ChartViewSwitch, MarketLensPanel, MarketVerdict, chartViews } from "./market-analysis";

type ChartType = "candles" | "area";

type SymbolChartModalProps = {
  symbol: string;
  /**
   * The row's own quote, used to paint the header while the deeper history
   * loads. It carries no overlays, so the chart still waits for the fetch.
   */
  seed?: MarketData | null;
  drawdownRange?: DrawdownRange;
  onClose: () => void;
};

export function SymbolChartModal({ symbol, seed = null, drawdownRange = "1y", onClose }: SymbolChartModalProps) {
  const [range, setRange] = useState<MarketRange>("1y");
  const [view, setView] = useState<ChartView>("trend");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextRange: MarketRange) => {
      setLoading(true);
      setError("");

      try {
        const url = new URL("/api/market", window.location.origin);
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("range", nextRange);
        url.searchParams.set("interval", "1d");
        url.searchParams.set("drawdownRange", drawdownRange);
        url.searchParams.set("overlays", "1");
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load chart");
        setData(payload as MarketData);
      } catch (fetchError) {
        // Same contract as the tables: a dead provider shows demo data and
        // says so, rather than an empty frame.
        setData(fallbackMarketData(symbol, nextRange, drawdownRange, true));
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load chart");
      } finally {
        setLoading(false);
      }
    },
    [drawdownRange, symbol]
  );

  useEffect(() => {
    load(range);
  }, [load, range]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const header = data || seed;
  const activeView = chartViews.find((item) => item.value === view)!;
  const tone = (header?.changePercent ?? 0) >= 0 ? "text-mint-signal" : "text-rose-signal";

  return (
    <div
      className="fixed inset-0 z-50 bg-[#03070c]/88 px-3 py-4 backdrop-blur-xl md:px-6 md:py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="mx-auto grid h-full max-w-[1480px] grid-rows-[auto_1fr] overflow-hidden rounded-3xl border border-white/10 bg-[#071019]/95 shadow-[0_24px_100px_rgba(0,0,0,.62)]"
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} chart`}
      >
        <header className="grid gap-4 border-b border-white/10 px-4 py-4 md:px-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">{header?.exchange || header?.source || "Market chart"}</p>
              <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                <h2 className="font-serif text-4xl leading-none text-white md:text-6xl">{header?.symbol || symbol}</h2>
                {header && <span className="pb-1 text-sm font-bold text-slate-400 md:text-base">{header.name}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="justify-self-end grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-xl font-black text-slate-300 hover:text-white"
              aria-label="Close chart"
            >
              X
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-1">
              {marketRanges.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setRange(item.value)}
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
            <div className="inline-flex overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setChartType("candles")}
                className={`rounded-xl px-3 py-2 text-sm font-black ${chartType === "candles" ? "bg-cyan-signal text-[#05110e]" : "text-slate-300 hover:text-white"}`}
              >
                Candles
              </button>
              <button
                type="button"
                onClick={() => setChartType("area")}
                className={`rounded-xl px-3 py-2 text-sm font-black ${chartType === "area" ? "bg-cyan-signal text-[#05110e]" : "text-slate-300 hover:text-white"}`}
              >
                Line
              </button>
            </div>
            <span className="text-sm font-bold text-slate-400">{activeView.tag}</span>
          </div>
        </header>

        <section className="grid min-h-0 gap-4 overflow-y-auto p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="grid min-h-0 content-start gap-3">
            {header && (
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
                <Metric label="Price" value={currencyFormat(header.price, header.currency)} />
                <Metric label="Day" value={`${currencyFormat(header.change, header.currency)} ${percentFormat(header.changePercent)}`} tone={tone} />
                <Metric
                  label={`${data?.rangeLabel || header.rangeLabel} move`}
                  value={percentFormat(header.rangeChange)}
                  tone={header.rangeChange >= 0 ? "text-mint-signal" : "text-rose-signal"}
                />
                <Metric label={`${header.drawdownLabel} top`} value={currencyFormat(header.previousTop, header.currency)} />
                <Metric label="From top" value={percentFormat(header.drawdownPercent)} tone="text-amber-signal" />
              </div>
            )}

            {error && (
              <p className="rounded-2xl border border-rose-signal/40 bg-rose-signal/10 px-4 py-3 text-sm font-bold text-rose-signal">
                {error} — showing offline demo data.
              </p>
            )}

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20">
              {loading && (
                <div className="grid h-[52vh] min-h-[380px] place-items-center">
                  <div className="h-16 w-16 animate-pulse rounded-full border border-cyan-signal/50 bg-cyan-signal/10" />
                </div>
              )}
              {!loading && data && <MarketChart data={data} chartType={chartType} view={view} className="h-[52vh] min-h-[380px]" />}
            </div>

            {data && (
              <p className="px-1 text-xs text-slate-500">
                {data.analytics.bars} bars shown, {data.analytics.historyBars} read from {data.analytics.historyFrom} so the
                200-day average and twelve-month momentum are defined on the first bar. Source: {data.source}.
              </p>
            )}
          </div>

          <aside className="grid content-start gap-3">
            {data && <MarketVerdict data={data} />}
            {data && <MarketLensPanel data={data} view={view} />}
          </aside>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.045] px-4 py-3">
      <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <strong className={`mt-1 block text-lg font-black ${tone}`}>{value}</strong>
    </div>
  );
}
