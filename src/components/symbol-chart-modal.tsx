"use client";

import { useEffect } from "react";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { MarketData } from "@/types/market";
import { MarketChart } from "./market-chart";

type ChartType = "candles" | "area";

type SymbolChartModalProps = {
  chartType: ChartType;
  data: MarketData | null;
  error?: string;
  loading?: boolean;
  onChartTypeChange: (chartType: ChartType) => void;
  onClose: () => void;
};

export function SymbolChartModal({
  chartType,
  data,
  error = "",
  loading = false,
  onChartTypeChange,
  onClose
}: SymbolChartModalProps) {
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

  const tone = (data?.changePercent ?? 0) >= 0 ? "text-mint-signal" : "text-rose-signal";

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
        aria-label={data ? `${data.symbol} chart` : "Symbol chart"}
      >
        <header className="grid gap-4 border-b border-white/10 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center md:px-6">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">{data?.exchange || data?.source || "Market chart"}</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
              <h2 className="font-serif text-4xl leading-none text-white md:text-6xl">{data?.symbol || "Loading"}</h2>
              {data && <span className="pb-1 text-sm font-bold text-slate-400 md:text-base">{data.name}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => onChartTypeChange("candles")}
                className={`rounded-xl px-3 py-2 text-sm font-black ${chartType === "candles" ? "bg-cyan-signal text-[#05110e]" : "text-slate-300 hover:text-white"}`}
              >
                Candles
              </button>
              <button
                type="button"
                onClick={() => onChartTypeChange("area")}
                className={`rounded-xl px-3 py-2 text-sm font-black ${chartType === "area" ? "bg-cyan-signal text-[#05110e]" : "text-slate-300 hover:text-white"}`}
              >
                Area
              </button>
            </div>
            <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-xl font-black text-slate-300 hover:text-white" aria-label="Close chart">
              X
            </button>
          </div>
        </header>

        <section className="grid min-h-0 grid-rows-[auto_1fr] gap-4 p-4 md:p-6">
          {data && (
            <div className="grid gap-2 md:grid-cols-5">
              <Metric label="Price" value={currencyFormat(data.price, data.currency)} />
              <Metric label="Day" value={`${currencyFormat(data.change, data.currency)} ${percentFormat(data.changePercent)}`} tone={tone} />
              <Metric label="1Y Move" value={percentFormat(data.rangeChange)} tone={data.rangeChange >= 0 ? "text-mint-signal" : "text-rose-signal"} />
              <Metric label="Top" value={currencyFormat(data.previousTop, data.currency)} />
              <Metric label="From Top" value={percentFormat(data.drawdownPercent)} tone="text-amber-signal" />
            </div>
          )}

          <div className="min-h-0 overflow-hidden rounded-3xl border border-white/10 bg-black/20">
            {loading && (
              <div className="grid h-full min-h-[460px] place-items-center">
                <div className="h-16 w-16 animate-pulse rounded-full border border-cyan-signal/50 bg-cyan-signal/10" />
              </div>
            )}
            {!loading && error && <div className="grid h-full min-h-[460px] place-items-center px-6 text-center font-bold text-rose-signal">{error}</div>}
            {!loading && !error && data && <MarketChart data={data} chartType={chartType} className="h-[62vh] min-h-[460px]" />}
          </div>
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
