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
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type SeriesType,
  type Time
} from "lightweight-charts";
import { currencyFormat, percentFormat } from "@/lib/format";
import {
  CDC_FAST,
  CDC_SLOW,
  REGRESSION_DEVIATIONS,
  cdcActionZone,
  chartSeries,
  regressionAt,
  regressionTrend,
  type CdcZone
} from "@/lib/indicators";
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
type LegendEntry = { color: string; label: string; dashed?: boolean; swatch?: boolean };

const colors = {
  price: "#52d6ff",
  fast: "#b18cff",
  slow: "#ffcc66",
  up: "#14ce99",
  down: "#ff5278",
  // The channel is deliberately monochrome so the price line stays the only
  // cyan thing on the pane, with amber reserved for the 2-sigma edges.
  trend: "rgba(237, 245, 255, 0.7)",
  band1: "rgba(237, 245, 255, 0.28)",
  band2: "rgba(255, 204, 102, 0.55)",
  regressionEdge: "rgba(237, 245, 255, 0.45)"
};

/** CDC ActionZone's six bar colours, in this palette. */
export const cdcColors: Record<CdcZone, string> = {
  green: "#14ce99",
  yellow: "#ffd84d",
  orange: "#ff9f43",
  red: "#ff5278",
  lightBlue: "#8be9ff",
  blue: "#4c7dff"
};

const cdcLegend: Array<{ zone: CdcZone; label: string }> = [
  { zone: "green", label: "Green: buy" },
  { zone: "yellow", label: "Yellow: pullback" },
  { zone: "orange", label: "Orange: warning" },
  { zone: "red", label: "Red: sell" },
  { zone: "lightBlue", label: "Light blue: bounce" },
  { zone: "blue", label: "Blue: recovery" }
];

type LogFit = { slope: number; intercept: number; sigma: number };

/** Overlays arrive aligned to every bar loaded, with null for warm-up gaps. */
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

/**
 * The fitted trend and its sigma bands, drawn straight from the regression.
 * The fit is indexed from the first bar of the window, so it is drawn there
 * and no earlier: the lead bars were never part of it.
 */
function band(candles: Candle[], windowStart: number, fit: LogFit | null, sigmas: number): LineData<Time>[] {
  if (!fit) return [];
  return candles.slice(windowStart).map((candle, offset) => ({
    time: candle.time,
    value: Math.exp(fit.intercept + fit.slope * offset + sigmas * fit.sigma)
  }));
}

function residualZ(candles: Candle[], windowStart: number, fit: LogFit | null): LineData<Time>[] {
  if (!fit || !fit.sigma) return [];
  return candles.slice(windowStart).map((candle, offset) => ({
    time: candle.time,
    value: (Math.log(candle.close) - (fit.intercept + fit.slope * offset)) / fit.sigma
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

/**
 * The price chart. It plots every bar loaded -- the window asked for plus the
 * warm-up before it -- and opens framed on the window, so zooming out shows
 * the earlier prices. Every fit (the regression trend, the value channel) is
 * computed over the window alone and stays put when the view moves.
 */
export function MarketChart({
  data,
  chartType,
  view = "summary",
  className = "h-[380px] min-h-[320px] sm:h-[420px] md:h-[548px]"
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const priceRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const barsRef = useRef<Candle[]>([]);
  const dataRef = useRef<MarketData | null>(null);
  // Re-frames the window on resize until the user pans or zooms themselves.
  const frameWindowRef = useRef<() => void>(() => {});
  const userMovedRef = useRef(false);
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
        timeVisible: false,
        // Ten years of daily bars must still fit when zoomed all the way out.
        minBarSpacing: 0.05
      }
    });

    chartRef.current = chart;
    const resizeObserver = new ResizeObserver(() => {
      if (!userMovedRef.current) frameWindowRef.current();
    });
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

    // Same data, new lens: keep whatever the user had zoomed to.
    const keepRange = data !== null && dataRef.current === data ? chart.timeScale().getVisibleLogicalRange() : null;
    dataRef.current = data;

    markersRef.current?.detach();
    markersRef.current = null;
    seriesRef.current.forEach((series) => chart.removeSeries(series));
    seriesRef.current = [];
    priceRef.current = null;
    for (let index = chart.panes().length - 1; index > 0; index -= 1) chart.removePane(index);

    if (!data) {
      barsRef.current = [];
      setLegend([]);
      return;
    }

    const { candles, volume, windowStart } = chartSeries(data);
    const { overlays } = data;
    barsRef.current = candles;
    const entries: LegendEntry[] = [];
    const markers: SeriesMarker<Time>[] = [];

    function track<T extends SeriesType>(series: ISeriesApi<T>) {
      seriesRef.current.push(series as ISeriesApi<SeriesType>);
      return series;
    }

    function line(color: string, width: 1 | 2, style: LineStyle = LineStyle.Solid) {
      return track(
        chart!.addSeries(
          LineSeries,
          { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
          0
        )
      );
    }

    const cdc = view === "summary" ? cdcActionZone(candles) : null;

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
      // CDC paints each bar its zone colour, the way the TradingView study does.
      const bars: CandlestickData<Time>[] = cdc
        ? candles.map((candle, index) => {
            const zone = cdc.zones[index];
            if (!zone) return candle;
            const color = cdcColors[zone];
            return { ...candle, color, wickColor: color, borderColor: color };
          })
        : candles;
      (price as ISeriesApi<"Candlestick">).setData(bars);
    } else {
      (price as ISeriesApi<"Area">).setData(candles.map((candle) => ({ time: candle.time, value: candle.close })));
    }
    priceRef.current = price;
    entries.push({
      color: colors.price,
      label: chartType === "candles" ? (cdc ? "Candles coloured by CDC zone" : "Price candles") : "Close"
    });

    price.priceScale().applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      scaleMargins: { top: 0.08, bottom: view === "value" ? 0.08 : 0.22 }
    });

    if (view === "summary" || view === "trend") {
      const volumeSeries = track(
        chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false }, 0)
      );
      volumeSeries.setData(volume);
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }

    if (view === "summary" && cdc) {
      // Coloured by side, as the study's fill between the two averages is.
      const sideColor = (index: number, alpha: number) =>
        cdc.fast[index] > cdc.slow[index] ? `rgba(20, 206, 153, ${alpha})` : `rgba(255, 82, 120, ${alpha})`;
      const from = CDC_SLOW - 1;
      line(colors.up, 1).setData(
        candles.slice(from).map((candle, offset) => ({ time: candle.time, value: cdc.fast[from + offset], color: sideColor(from + offset, 0.9) }))
      );
      line(colors.up, 2).setData(
        candles.slice(from).map((candle, offset) => ({ time: candle.time, value: cdc.slow[from + offset], color: sideColor(from + offset, 0.5) }))
      );
      for (const signal of cdc.signals) {
        markers.push({
          time: signal.time,
          position: signal.type === "buy" ? "belowBar" : "aboveBar",
          color: signal.type === "buy" ? colors.up : colors.down,
          shape: signal.type === "buy" ? "arrowUp" : "arrowDown",
          text: signal.type === "buy" ? "BUY" : "SELL"
        });
      }

      // Fitted to the window only; indices come back relative to it.
      const trend = regressionTrend(candles.slice(windowStart));
      if (trend) {
        const start = windowStart + trend.startIndex;
        const end = windowStart + trend.endIndex;
        const segment = candles.slice(start, end + 1);
        const at = (index: number, deviations = 0) => regressionAt(trend, index - windowStart, deviations);
        const trendColor = trend.slope >= 0 ? colors.up : colors.down;

        line(trendColor, 2).setData(segment.map((candle, offset) => ({ time: candle.time, value: at(start + offset) })));
        for (const deviations of [REGRESSION_DEVIATIONS, -REGRESSION_DEVIATIONS]) {
          line(colors.regressionEdge, 1).setData(
            segment.map((candle, offset) => ({ time: candle.time, value: at(start + offset, deviations) }))
          );
        }
        // Where the line would be today if the move carried on.
        if (end < candles.length - 1) {
          line(trendColor, 1, LineStyle.Dotted).setData(
            candles.slice(end).map((candle, offset) => ({ time: candle.time, value: at(end + offset) }))
          );
        }

        markers.push(
          { time: trend.high.time, position: "aboveBar", color: "rgba(237, 245, 255, 0.85)", shape: "circle", text: "High" },
          { time: trend.low.time, position: "belowBar", color: "rgba(237, 245, 255, 0.85)", shape: "circle", text: "Low" }
        );
        entries.push(
          {
            color: trendColor,
            label: `Regression ${trend.direction === "high-to-low" ? "high -> low" : "low -> high"} · ${percentFormat(trend.changePercent)} · R ${trend.pearsonR.toFixed(2)}`
          },
          { color: colors.regressionEdge, label: `+/- ${REGRESSION_DEVIATIONS} std dev` },
          { color: trendColor, label: "Regression extended to today", dashed: true }
        );
      }

      entries.push(
        { color: colors.up, label: `EMA ${CDC_FAST} (thin) / EMA ${CDC_SLOW} (thick): green bull, red bear` },
        ...cdcLegend.map((item) => ({ color: cdcColors[item.zone], label: item.label, swatch: true }))
      );
    }

    if (view === "trend") {
      line(colors.fast, 1).setData(zip(candles, overlays?.sma50));
      line(colors.slow, 2).setData(zip(candles, overlays?.sma200));
      entries.push({ color: colors.fast, label: "50-day average" }, { color: colors.slow, label: "200-day average" });

      for (const cross of overlays?.crosses || []) {
        markers.push({
          time: cross.time,
          position: cross.type === "golden" ? "belowBar" : "aboveBar",
          color: cross.type === "golden" ? colors.up : colors.down,
          shape: cross.type === "golden" ? "arrowUp" : "arrowDown",
          text: cross.type === "golden" ? "50>200" : "50<200"
        });
      }

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

    if (view === "value") {
      const fit = data.analytics.value.logFit;
      line(colors.trend, 2, LineStyle.Dashed).setData(band(candles, windowStart, fit, 0));
      for (const sigmas of [1, -1]) line(colors.band1, 1).setData(band(candles, windowStart, fit, sigmas));
      for (const sigmas of [2, -2]) line(colors.band2, 1, LineStyle.Dashed).setData(band(candles, windowStart, fit, sigmas));

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
      zScore.setData(residualZ(candles, windowStart, fit));
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
        { color: colors.trend, label: "Fitted log trend (window only)", dashed: true },
        { color: colors.band1, label: "+/- 1 sigma" },
        { color: colors.band2, label: "+/- 2 sigma", dashed: true },
        { color: colors.down, label: "Lower pane: sigma from trend" }
      );
    }

    if (markers.length) {
      markers.sort((first, second) => (String(first.time) < String(second.time) ? -1 : String(first.time) > String(second.time) ? 1 : 0));
      markersRef.current = createSeriesMarkers(price, markers);
    }

    chart.panes().forEach((pane, index) => pane.setStretchFactor(index === 0 ? 5 : 1.4));

    frameWindowRef.current = () => {
      if (!candles.length) return;
      chart.timeScale().setVisibleLogicalRange({ from: windowStart - 0.5, to: candles.length - 0.5 + 2 });
    };
    if (keepRange) {
      chart.timeScale().setVisibleLogicalRange(keepRange);
    } else {
      userMovedRef.current = false;
      frameWindowRef.current();
    }

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
    const bars = barsRef.current;
    if (!bars.length || !containerRef.current || !chart || !series) return null;

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

    const index = clamp(Math.round(Number(logical)), 0, Math.max(bars.length - 1, 0));
    const candle = bars[index];
    if (!candle) return null;

    return { x, y, price, index, time: candle.time };
  }

  function startMeasurement(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    if (effectiveInteractionMode !== "measure") {
      userMovedRef.current = true;
      return;
    }

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
      onWheelCapture={() => {
        userMovedRef.current = true;
      }}
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
      {legend.length > 0 && <ChartLegend entries={legend} />}
      <div ref={containerRef} className="h-full w-full" />
      {measurement && <MeasurementOverlay currency={data?.currency || "USD"} measurement={measurement} />}
    </div>
  );
}

/**
 * The legend folds into an "i" in the corner so it never sits on the price.
 * Hovering it, or focusing it (a tap on touch), unfolds the full card in place.
 */
function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div data-chart-ui className="group absolute right-3 top-3 z-20">
      <button
        type="button"
        aria-label="Chart legend"
        className="grid size-7 place-items-center rounded-full border border-white/15 bg-[#071019]/85 text-slate-300 shadow-[0_8px_24px_rgba(0,0,0,.35)] backdrop-blur-md transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 hover:text-white"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="5" r="0.95" fill="currentColor" />
          <path d="M8 7.3v4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-0 grid max-w-[calc(100vw-3rem)] origin-top-right scale-95 gap-0.5 rounded-xl border border-white/10 bg-[#071019]/92 px-2 py-1.5 text-[10px] font-bold text-slate-300 opacity-0 shadow-[0_16px_50px_rgba(0,0,0,.42)] backdrop-blur-md transition duration-150 ease-out group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100 group-focus-within:opacity-100 sm:gap-1 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-[11px]"
      >
        {entries.map((entry) => (
          <span key={entry.label} className="flex items-center gap-2 whitespace-nowrap">
            {entry.swatch ? (
              <i aria-hidden="true" className="inline-block size-2.5 rounded-[3px]" style={{ background: entry.color }} />
            ) : (
              <i
                aria-hidden="true"
                className="inline-block h-0 w-4 border-t-2"
                style={{ borderColor: entry.color, borderTopStyle: entry.dashed ? "dashed" : "solid" }}
              />
            )}
            {entry.label}
          </span>
        ))}
      </div>
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
  return target instanceof HTMLElement && Boolean(target.closest("a, button, input, select, textarea, [data-chart-ui]"));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
