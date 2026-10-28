"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time
} from "lightweight-charts";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { NetWorthHistory, NetWorthPoint } from "@/types/portfolio";

type DisplayCurrency = "USD" | "THB";
type Zoom = "3M" | "6M" | "1Y" | "ALL";

const zooms: Array<{ value: Zoom; days: number | null }> = [
  { value: "3M", days: 92 },
  { value: "6M", days: 183 },
  { value: "1Y", days: 366 },
  { value: "ALL", days: null }
];

const colors = {
  value: "#52d6ff",
  invested: "rgba(237, 245, 255, 0.7)"
};

type Hover = { point: NetWorthPoint; x: number; width: number };

/**
 * Net worth against money put in, day by day since the first trade. The gap
 * between the two lines is the profit; hovering a day shows both figures and
 * the difference. Values arrive in USD with that day's rate, so switching the
 * page to baht converts each day at its own rate rather than today's.
 */
export function NetWorthChart({ displayCurrency, version }: { displayCurrency: DisplayCurrency; version: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const valueRef = useRef<ISeriesApi<"Area"> | null>(null);
  const investedRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Re-run on resize: a phone rotating keeps the old bar spacing otherwise.
  const applyZoomRef = useRef<() => void>(() => {});
  const [history, setHistory] = useState<NetWorthHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<Zoom>("ALL");
  const [hover, setHover] = useState<Hover | null>(null);

  const points = useMemo(() => history?.points ?? [], [history]);
  const byTime = useMemo(() => new Map(points.map((point) => [point.time, point])), [points]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/portfolio/history")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load the net-worth history");
        if (!cancelled) setHistory(payload as NetWorthHistory);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load the net-worth history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(237, 245, 255, 0.72)",
        fontFamily: "Avenir Next, Segoe UI, sans-serif"
      },
      grid: {
        vertLines: { color: "rgba(205, 220, 255, 0.06)" },
        horzLines: { color: "rgba(205, 220, 255, 0.06)" }
      },
      crosshair: {
        vertLine: { color: "rgba(82, 214, 255, 0.42)", labelBackgroundColor: "#141b24" },
        horzLine: { visible: false, labelVisible: false }
      },
      rightPriceScale: { borderColor: "rgba(205, 220, 255, 0.12)" },
      // ~1,000 daily points must fit a phone-width "All" without scrolling.
      timeScale: { borderColor: "rgba(205, 220, 255, 0.12)", timeVisible: false, minBarSpacing: 0.05 },
      handleScroll: false,
      handleScale: false
    });

    valueRef.current = chart.addSeries(AreaSeries, {
      lineColor: colors.value,
      topColor: "rgba(82, 214, 255, 0.3)",
      bottomColor: "rgba(82, 214, 255, 0.02)",
      lineWidth: 2,
      priceLineVisible: false
    });
    investedRef.current = chart.addSeries(LineSeries, {
      color: colors.invested,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    chartRef.current = chart;
    const resizeObserver = new ResizeObserver(() => applyZoomRef.current());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      valueRef.current = null;
      investedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    function onMove(param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) {
      const point = param.time ? byTime.get(String(param.time)) : undefined;
      if (!point || !param.point || param.point.x < 0 || param.point.y < 0) {
        setHover(null);
        return;
      }
      setHover({ point, x: param.point.x, width: containerRef.current?.clientWidth ?? 0 });
    }

    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [byTime]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !valueRef.current || !investedRef.current) return;

    const convert = (amount: number, point: NetWorthPoint) => (displayCurrency === "THB" ? amount * point.fx : amount);

    valueRef.current.setData(points.map((point) => ({ time: point.time as Time, value: convert(point.value, point) })));
    investedRef.current.setData(points.map((point) => ({ time: point.time as Time, value: convert(point.invested, point) })));
    chart.applyOptions({
      localization: { priceFormatter: (value: number) => compactMoney(value, displayCurrency) }
    });

    applyZoomRef.current = () => {
      const span = zooms.find((item) => item.value === zoom)?.days;
      const last = points.at(-1);
      if (!last || !span) {
        chart.timeScale().fitContent();
        return;
      }

      const from = new Date(new Date(`${last.time}T00:00:00Z`).getTime() - span * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      chart.timeScale().setVisibleRange({ from: (from < points[0].time ? points[0].time : from) as Time, to: last.time as Time });
    };
    applyZoomRef.current();
  }, [points, displayCurrency, zoom]);

  const latest = points.at(-1);
  const shown = hover?.point ?? latest;

  return (
    <section className="glass-panel overflow-hidden rounded-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 p-4 sm:p-6">
        <div>
          <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">History</p>
          <h2 className="text-2xl font-black">Net worth over time</h2>
        </div>
        <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Chart window">
          {zooms.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={zoom === item.value}
              onClick={() => setZoom(item.value)}
              className={`min-h-9 min-w-11 rounded-xl px-2 text-sm font-black transition ${
                zoom === item.value ? "bg-white text-[#05110e]" : "text-slate-400 hover:text-white"
              }`}
            >
              {item.value === "ALL" ? "All" : item.value}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-3 sm:px-6 [&>:first-child]:col-span-2 sm:[&>:first-child]:col-span-1">
        <Figure label={hover ? formatDay(hover.point.time) : "Net worth"} value={shown ? money(shown.value, shown, displayCurrency) : "—"} tone="text-cyan-signal" />
        <Figure label="Money in" value={shown ? money(shown.invested, shown, displayCurrency) : "—"} />
        <Figure
          label="Profit"
          value={shown ? money(shown.value - shown.invested, shown, displayCurrency) : "—"}
          sub={shown ? percentFormat(profitPercent(shown)) : undefined}
          tone={shown && shown.value >= shown.invested ? "text-mint-signal" : "text-rose-signal"}
        />
      </div>

      <div className="relative px-2 pb-2 sm:px-4">
        <div ref={containerRef} className="h-[280px] sm:h-[340px]" />
        {hover && (
          <div
            className="pointer-events-none absolute top-3 z-10 hidden w-64 rounded-2xl border border-white/10 bg-[#0b121b]/95 p-3 text-sm shadow-xl sm:block"
            style={{
              // Flip to the cursor's left near the right edge, so the card never covers the point it describes.
              left: hover.x + 280 > hover.width ? Math.max(hover.x - 280, 8) : hover.x + 24
            }}
          >
            <strong className="mb-2 block text-slate-300">{formatDay(hover.point.time)}</strong>
            <Row color={colors.value} label="Net worth" value={money(hover.point.value, hover.point, displayCurrency)} />
            <Row color={colors.invested} label="Money in" value={money(hover.point.invested, hover.point, displayCurrency)} dashed />
            <Row
              label="Profit"
              value={`${money(hover.point.value - hover.point.invested, hover.point, displayCurrency)} ${percentFormat(profitPercent(hover.point))}`}
              tone={hover.point.value >= hover.point.invested ? "text-mint-signal" : "text-rose-signal"}
            />
          </div>
        )}
        {loading && !points.length && (
          <p className="absolute inset-0 grid place-items-center text-sm text-slate-400">Replaying trades against daily prices...</p>
        )}
        {!loading && !error && !points.length && (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-400">
            No transactions yet. Record a buy or a deposit to start the history.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/10 px-4 py-3 text-xs text-slate-400 sm:px-6">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded" style={{ background: colors.value }} /> Net worth (holdings + cash)
        </span>
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed" style={{ borderColor: colors.invested }} /> Money in (cost + cash)
        </span>
        {error && <span className="text-rose-signal">{error}</span>}
        {history?.untracked.length ? (
          <span className="text-amber-signal">
            No trade history for {history.untracked.join(", ")}: counted at cost from the day each was first saved.
          </span>
        ) : null}
        {history?.unpriced.length ? (
          <span className="text-amber-signal">No price history for {history.unpriced.join(", ")}: valued at cost.</span>
        ) : null}
      </div>
    </section>
  );
}

function Figure({ label, value, sub, tone = "text-white" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-3">
      <span className="block truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <strong className={`mt-1 block truncate text-base font-black tabular-nums sm:text-lg ${tone}`}>
        {value}
        {sub && <span className="block text-xs sm:ml-2 sm:inline sm:text-base">{sub}</span>}
      </strong>
    </div>
  );
}

function Row({ label, value, color, dashed, tone = "text-white" }: { label: string; value: string; color?: string; dashed?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-2 text-slate-400">
        {color && (dashed ? <span className="w-3 border-t-2 border-dashed" style={{ borderColor: color }} /> : <span className="h-0.5 w-3 rounded" style={{ background: color }} />)}
        {label}
      </span>
      <strong className={`tabular-nums ${tone}`}>{value}</strong>
    </div>
  );
}

function money(amount: number, point: NetWorthPoint, currency: DisplayCurrency) {
  return currencyFormat(currency === "THB" ? amount * point.fx : amount, currency);
}

/** Against cost alone, like Total P/L above: cash earns nothing and would dilute it. */
function profitPercent(point: NetWorthPoint) {
  const cost = point.invested - point.cash;
  return cost > 0 ? ((point.value - point.invested) / cost) * 100 : 0;
}

function compactMoney(value: number, currency: DisplayCurrency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDay(time: string) {
  return new Date(`${time}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
