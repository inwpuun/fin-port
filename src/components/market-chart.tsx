"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type SeriesType,
  type Time
} from "lightweight-charts";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { Candle, ChartView, MarketData } from "@/types/market";

type MarketChartProps = {
  data: MarketData | null;
  chartType: "candles" | "area";
  view?: ChartView;
  className?: string;
};

type MeasurePoint = {
  x: number;
  y: number;
  price: number;
  index: number;
  time: string;
};

type Measurement = {
  start: MeasurePoint;
  end: MeasurePoint;
  active: boolean;
};

type ChartInteractionMode = "move" | "measure";
type LegendEntry = { color: string; label: string; dashed?: boolean };

const colors = {
  price: "#52d6ff",
  fast: "#b18cff",
  slow: "#ffcc66",
  up: "#14ce99",
  down: "#ff5278",
  vol: "#b18cff",
  // The channel is deliberately monochrome so the price line stays the only
  // cyan thing on the pane, with amber reserved for the 2-sigma edges.
  trend: "rgba(237, 245, 255, 0.7)",
  band1: "rgba(237, 245, 255, 0.28)",
  band2: "rgba(255, 204, 102, 0.55)"
};

type LogFit = { slope: number; intercept: number; sigma: number };

/** Overlays arrive aligned to `candles` by index, with null for warm-up gaps. */
function zip(candles: Candle[], values?: Array<number | null>): LineData<Time>[] {
  if (!values) return [];
  const points: LineData<Time>[] = [];
  const count = Math.min(candles.length, values.length);

  for (let index = 0; index < count; index += 1) {
    const value = values[index];
    if (value === null || !Number.isFinite(value)) continue;
    points.push({ time: candles[index].time, value });
  }

  return points;
}

/** The fitted trend and its sigma bands, drawn straight from the regression. */
function band(candles: Candle[], fit: LogFit | null, sigmas: number): LineData<Time>[] {
  if (!fit) return [];
  return candles.map((candle, index) => ({
    time: candle.time,
    value: Math.exp(fit.intercept + fit.slope * index + sigmas * fit.sigma)
  }));
}

function residualZ(candles: Candle[], fit: LogFit | null): LineData<Time>[] {
  if (!fit || !fit.sigma) return [];
  return candles.map((candle, index) => ({
    time: candle.time,
    value: (Math.log(candle.close) - (fit.intercept + fit.slope * index)) / fit.sigma
  }));
}

function gapFromSlow(candles: Candle[], slow?: Array<number | null>): LineData<Time>[] {
  if (!slow) return [];
  const points: LineData<Time>[] = [];

  for (let index = 0; index < candles.length && index < slow.length; index += 1) {
    const average = slow[index];
    if (average === null || !average) continue;
    points.push({ time: candles[index].time, value: (candles[index].close / average - 1) * 100 });
  }

  return points;
}

export function MarketChart({
  data,
  chartType,
  view = "trend",
  className = "h-[420px] min-h-[360px] md:h-[548px]"
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const priceRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const dragStartRef = useRef<MeasurePoint | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [interactionMode, setInteractionMode] = useState<ChartInteractionMode>("measure");
  const [logScale, setLogScale] = useState(true);
  const [legend, setLegend] = useState<LegendEntry[]>([]);
  const [shiftHeld, setShiftHeld] = useState(false);
  const effectiveInteractionMode: ChartInteractionMode = shiftHeld ? "move" : interactionMode;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(237, 245, 255, 0.72)",
        fontFamily: "Avenir Next, Segoe UI, sans-serif",
        panes: { separatorColor: "rgba(205, 220, 255, 0.14)", separatorHoverColor: "rgba(82, 214, 255, 0.3)", enableResize: true }
      },
      grid: {
        vertLines: { color: "rgba(205, 220, 255, 0.06)" },
        horzLines: { color: "rgba(205, 220, 255, 0.06)" }
      },
      crosshair: {
        vertLine: { color: "rgba(82, 214, 255, 0.42)", labelBackgroundColor: "#141b24" },
        horzLine: { color: "rgba(82, 214, 255, 0.42)", labelBackgroundColor: "#141b24" }
      },
      rightPriceScale: {
        borderColor: "rgba(205, 220, 255, 0.12)"
      },
      timeScale: {
        borderColor: "rgba(205, 220, 255, 0.12)",
        timeVisible: false
      }
    });

    chartRef.current = chart;
    const resizeObserver = new ResizeObserver(() => chart.timeScale().fitContent());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
      priceRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // One effect owns every series: switching lens tears the old panes down and
  // builds the new ones, so no view can leave a stray line behind.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    markersRef.current?.detach();
    markersRef.current = null;
    seriesRef.current.forEach((series) => chart.removeSeries(series));
    seriesRef.current = [];
    priceRef.current = null;
    for (let index = chart.panes().length - 1; index > 0; index -= 1) chart.removePane(index);

    if (!data) {
      setLegend([]);
      return;
    }

    const { candles, overlays } = data;
    const entries: LegendEntry[] = [];

    function track<T extends SeriesType>(series: ISeriesApi<T>) {
      seriesRef.current.push(series as ISeriesApi<SeriesType>);
      return series;
    }

    const price =
      chartType === "candles"
        ? track(
            chart.addSeries(
              CandlestickSeries,
              {
                upColor: colors.up,
                downColor: colors.down,
                borderVisible: false,
                wickUpColor: colors.up,
                wickDownColor: colors.down
              },
              0
            )
          )
        : track(
            chart.addSeries(
              AreaSeries,
              {
                lineColor: colors.price,
                topColor: "rgba(82, 214, 255, 0.34)",
                bottomColor: "rgba(82, 214, 255, 0.02)",
                lineWidth: 2
              },
              0
            )
          );

    if (chartType === "candles") {
      (price as ISeriesApi<"Candlestick">).setData(candles);
    } else {
      (price as ISeriesApi<"Area">).setData(candles.map((candle) => ({ time: candle.time, value: candle.close })));
    }
    priceRef.current = price;
    entries.push({ color: colors.price, label: chartType === "candles" ? "Price candles" : "Close" });

    price.priceScale().applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      scaleMargins: { top: 0.08, bottom: view === "trend" ? 0.22 : 0.08 }
    });

    if (view === "trend") {
      const volume = track(
        chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" }, 0)
      );
      volume.setData(data.volume);
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      const fast = track(
        chart.addSeries(LineSeries, { color: colors.fast, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
      );
      fast.setData(zip(candles, overlays?.sma50));
      const slow = track(
        chart.addSeries(LineSeries, { color: colors.slow, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0)
      );
      slow.setData(zip(candles, overlays?.sma200));
      entries.push({ color: colors.fast, label: "50-day average" }, { color: colors.slow, label: "200-day average" });

      const markers: SeriesMarker<Time>[] = (overlays?.crosses || []).map((cross) => ({
        time: cross.time,
        position: cross.type === "golden" ? "belowBar" : "aboveBar",
        color: cross.type === "golden" ? colors.up : colors.down,
        shape: cross.type === "golden" ? "arrowUp" : "arrowDown",
        text: cross.type === "golden" ? "50>200" : "50<200"
      }));
      if (markers.length) markersRef.current = createSeriesMarkers(price, markers);

      const gap = track(
        chart.addSeries(HistogramSeries, { priceFormat: { type: "percent" }, base: 0 }, 1)
      );
      gap.setData(
        gapFromSlow(candles, overlays?.sma200).map((point) => ({
          ...point,
          color: point.value >= 0 ? "rgba(20, 206, 153, 0.55)" : "rgba(255, 82, 120, 0.55)"
        }))
      );
      gap.createPriceLine({ price: 0, color: "rgba(237, 245, 255, 0.4)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
      entries.push({ color: colors.up, label: "Lower pane: % from 200-day average" });
    }

    if (view === "risk") {
      const slow = track(
        chart.addSeries(
          LineSeries,
          { color: colors.slow, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false },
          0
        )
      );
      slow.setData(zip(candles, overlays?.sma200));

      const underwater = track(
        chart.addSeries(
          BaselineSeries,
          {
            baseValue: { type: "price", price: 0 },
            bottomLineColor: colors.down,
            bottomFillColor1: "rgba(255, 82, 120, 0.05)",
            bottomFillColor2: "rgba(255, 82, 120, 0.42)",
            topLineColor: colors.up,
            lineWidth: 2,
            priceFormat: { type: "percent" }
          },
          1
        )
      );
      underwater.setData(zip(candles, overlays?.drawdown));
      underwater.createPriceLine({
        price: data.analytics.risk.maxDrawdown,
        color: "rgba(255, 204, 102, 0.6)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "worst"
      });

      const volatility = track(
        chart.addSeries(LineSeries, { color: colors.vol, lineWidth: 2, priceFormat: { type: "percent" } }, 2)
      );
      volatility.setData(zip(candles, overlays?.volatility));
      if (data.analytics.risk.volMedian) {
        volatility.createPriceLine({
          price: data.analytics.risk.volMedian,
          color: "rgba(237, 245, 255, 0.35)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "median"
        });
      }

      entries.push(
        { color: colors.slow, label: "200-day average", dashed: true },
        { color: colors.down, label: "Middle pane: drawdown from peak" },
        { color: colors.vol, label: "Lower pane: 60-day volatility, annualised" }
      );
    }

    if (view === "value") {
      const fit = data.analytics.value.logFit;
      const mid = track(
        chart.addSeries(
          LineSeries,
          { color: colors.trend, lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false },
          0
        )
      );
      mid.setData(band(candles, fit, 0));

      for (const sigmas of [1, -1]) {
        const series = track(
          chart.addSeries(LineSeries, { color: colors.band1, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
        );
        series.setData(band(candles, fit, sigmas));
      }
      for (const sigmas of [2, -2]) {
        const series = track(
          chart.addSeries(
            LineSeries,
            { color: colors.band2, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false },
            0
          )
        );
        series.setData(band(candles, fit, sigmas));
      }

      const zScore = track(
        chart.addSeries(
          BaselineSeries,
          {
            baseValue: { type: "price", price: 0 },
            topLineColor: colors.down,
            topFillColor1: "rgba(255, 82, 120, 0.34)",
            topFillColor2: "rgba(255, 82, 120, 0.04)",
            bottomLineColor: colors.up,
            bottomFillColor1: "rgba(20, 206, 153, 0.04)",
            bottomFillColor2: "rgba(20, 206, 153, 0.34)",
            lineWidth: 2
          },
          1
        )
      );
      zScore.setData(residualZ(candles, fit));
      for (const level of [2, 1, -1, -2]) {
        zScore.createPriceLine({
          price: level,
          color: Math.abs(level) === 2 ? "rgba(255, 204, 102, 0.55)" : "rgba(237, 245, 255, 0.28)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `${level > 0 ? "+" : ""}${level}s`
        });
      }

      entries.push(
        { color: colors.trend, label: "Fitted log trend", dashed: true },
        { color: colors.band1, label: "+/- 1 sigma" },
        { color: colors.band2, label: "+/- 2 sigma", dashed: true },
        { color: colors.down, label: "Lower pane: sigma from trend" }
      );
    }

    const panes = chart.panes();
    const stretch = view === "risk" ? [5, 1.5, 1.3] : [5, 1.4];
    panes.forEach((pane, index) => pane.setStretchFactor(stretch[index] ?? 1));
    chart.timeScale().fitContent();
    setLegend(entries);
    setMeasurement(null);
  }, [data, chartType, view, logScale]);

  useEffect(() => {
    function syncShiftState(event: KeyboardEvent) {
      setShiftHeld(event.shiftKey);
      if (event.shiftKey) {
        dragStartRef.current = null;
        setMeasurement((current) => (current?.active ? null : current));
      }
    }

    function clearShiftState() {
      setShiftHeld(false);
    }

    window.addEventListener("keydown", syncShiftState);
    window.addEventListener("keyup", syncShiftState);
    window.addEventListener("blur", clearShiftState);

    return () => {
      window.removeEventListener("keydown", syncShiftState);
      window.removeEventListener("keyup", syncShiftState);
      window.removeEventListener("blur", clearShiftState);
    };
  }, []);

  function getMeasurePoint(event: PointerEvent<HTMLDivElement>): MeasurePoint | null {
    const chart = chartRef.current;
    const series = priceRef.current;
    if (!data || !containerRef.current || !chart || !series) return null;

    const bounds = containerRef.current.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left, 0, bounds.width);
    const y = event.clientY - bounds.top;
    // Only the price pane has prices on its axis; measuring across a lower
    // pane would read an oscillator value as if it were money.
    const priceHeight = chart.panes()[0]?.getHeight() ?? bounds.height;
    if (y < 0 || y > priceHeight) return null;

    const price = Number(series.coordinateToPrice(y));
    const logical = chart.timeScale().coordinateToLogical(x);

    if (!Number.isFinite(price) || logical === null) return null;

    const index = clamp(Math.round(Number(logical)), 0, Math.max(data.candles.length - 1, 0));
    const candle = data.candles[index];
    if (!candle) return null;

    return { x, y, price, index, time: candle.time };
  }

  function startMeasurement(event: PointerEvent<HTMLDivElement>) {
    if (effectiveInteractionMode !== "measure" || event.button !== 0 || isInteractiveTarget(event.target)) return;

    const point = getMeasurePoint(event);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = point;
    setMeasurement({ start: point, end: point, active: true });
  }

  function updateMeasurement(event: PointerEvent<HTMLDivElement>) {
    if (effectiveInteractionMode !== "measure" || !dragStartRef.current) return;

    const point = getMeasurePoint(event);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    setMeasurement({ start: dragStartRef.current, end: point, active: true });
  }

  function finishMeasurement(event: PointerEvent<HTMLDivElement>) {
    if (effectiveInteractionMode !== "measure" || !dragStartRef.current) return;

    const point = getMeasurePoint(event);
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMeasurement((current) =>
      current
        ? {
            start: current.start,
            end: point || current.end,
            active: false
          }
        : null
    );
    dragStartRef.current = null;
  }

  return (
    <div
      className={`relative select-none overflow-hidden ${effectiveInteractionMode === "measure" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"} ${className}`}
      data-market-chart
      onPointerCancelCapture={finishMeasurement}
      onPointerDownCapture={startMeasurement}
      onPointerMoveCapture={updateMeasurement}
      onPointerUpCapture={finishMeasurement}
    >
      <div className="absolute left-3 top-3 z-10 inline-flex overflow-hidden rounded-2xl border border-white/10 bg-[#071019]/88 p-1 text-xs font-black shadow-[0_12px_34px_rgba(0,0,0,.35)] backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            setInteractionMode("move");
            dragStartRef.current = null;
          }}
          className={`rounded-xl px-3 py-2 transition ${effectiveInteractionMode === "move" ? "bg-white text-[#05110e]" : "text-slate-300 hover:text-white"}`}
        >
          Move
        </button>
        <button
          type="button"
          onClick={() => setInteractionMode("measure")}
          className={`rounded-xl px-3 py-2 transition ${effectiveInteractionMode === "measure" ? "bg-cyan-signal text-[#05110e]" : "text-slate-300 hover:text-white"}`}
        >
          Measure
        </button>
        <button
          type="button"
          onClick={() => setLogScale((current) => !current)}
          title="Logarithmic price axis: equal percentage moves get equal height"
          className={`rounded-xl px-3 py-2 transition ${logScale ? "bg-amber-signal text-[#170f00]" : "text-slate-300 hover:text-white"}`}
        >
          Log
        </button>
      </div>
      {legend.length > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 grid gap-1 rounded-2xl border border-white/10 bg-[#071019]/82 px-3 py-2 text-[11px] font-bold text-slate-300 backdrop-blur-md">
          {legend.map((entry) => (
            <span key={entry.label} className="flex items-center gap-2 whitespace-nowrap">
              <i
                aria-hidden="true"
                className="inline-block h-0 w-4 border-t-2"
                style={{ borderColor: entry.color, borderTopStyle: entry.dashed ? "dashed" : "solid" }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
      {measurement && <MeasurementOverlay currency={data?.currency || "USD"} measurement={measurement} />}
    </div>
  );
}

function MeasurementOverlay({ currency, measurement }: { currency: string; measurement: Measurement }) {
  const { start, end } = measurement;
  const delta = end.price - start.price;
  const percent = start.price ? (delta / start.price) * 100 : 0;
  const barDelta = end.index - start.index;
  const labelLeft = end.x >= start.x ? end.x - 12 : end.x + 12;
  const labelTop = Math.max(end.y - 58, 12);
  const labelAlign = end.x >= start.x ? "-translate-x-full" : "";

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <line x1={start.x} y1={start.y} x2={end.x} y2={start.y} stroke="rgba(82, 214, 255, 0.3)" strokeDasharray="5 5" />
        <line x1={end.x} y1={start.y} x2={end.x} y2={end.y} stroke="rgba(82, 214, 255, 0.3)" strokeDasharray="5 5" />
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={delta >= 0 ? "#14ce99" : "#ff5278"} strokeWidth="2.5" />
        <circle cx={start.x} cy={start.y} r="5" fill="#071019" stroke="#52d6ff" strokeWidth="2" />
        <circle cx={end.x} cy={end.y} r="5" fill={delta >= 0 ? "#14ce99" : "#ff5278"} stroke="#071019" strokeWidth="2" />
      </svg>
      <div
        className={`absolute max-w-[260px] ${labelAlign} rounded-2xl border border-white/10 bg-[#071019]/92 px-3 py-2 text-xs shadow-[0_16px_50px_rgba(0,0,0,.42)] backdrop-blur-md`}
        style={{ left: labelLeft, top: labelTop }}
      >
        <strong className={delta >= 0 ? "block text-sm text-mint-signal" : "block text-sm text-rose-signal"}>
          {currencyFormat(delta, currency)} · {percentFormat(percent)}
        </strong>
        <span className="mt-1 block whitespace-nowrap text-slate-300">
          {currencyFormat(start.price, currency)} -&gt; {currencyFormat(end.price, currency)}
        </span>
        <span className="mt-1 block whitespace-nowrap text-slate-500">
          {start.time} -&gt; {end.time} · {barDelta >= 0 ? "+" : ""}
          {barDelta} bars
        </span>
      </div>
      {measurement.active && <div className="absolute inset-x-0 bottom-3 mx-auto h-1 w-28 rounded-full bg-cyan-signal/40" />}
    </div>
  );
}

function isInteractiveTarget(target: EventTarget) {
  return target instanceof HTMLElement && Boolean(target.closest("a, button, input, select, textarea"));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
