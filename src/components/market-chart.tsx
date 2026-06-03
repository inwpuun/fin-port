"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi
} from "lightweight-charts";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { MarketData } from "@/types/market";

type MarketChartProps = {
  data: MarketData | null;
  chartType: "candles" | "area";
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

export function MarketChart({ data, chartType, className = "h-[420px] min-h-[360px] md:h-[548px]" }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const dragStartRef = useRef<MeasurePoint | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [interactionMode, setInteractionMode] = useState<ChartInteractionMode>("measure");
  const [shiftHeld, setShiftHeld] = useState(false);
  const effectiveInteractionMode: ChartInteractionMode = shiftHeld ? "move" : interactionMode;

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
        horzLine: { color: "rgba(82, 214, 255, 0.42)", labelBackgroundColor: "#141b24" }
      },
      rightPriceScale: {
        borderColor: "rgba(205, 220, 255, 0.12)"
      },
      timeScale: {
        borderColor: "rgba(205, 220, 255, 0.12)",
        timeVisible: true
      }
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#14ce99",
      downColor: "#ff5278",
      borderVisible: false,
      wickUpColor: "#14ce99",
      wickDownColor: "#ff5278"
    });
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: "#52d6ff",
      topColor: "rgba(82, 214, 255, 0.34)",
      bottomColor: "rgba(82, 214, 255, 0.02)",
      lineWidth: 2,
      visible: false
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume"
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    areaRef.current = areaSeries;
    volumeRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(() => chart.timeScale().fitContent());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      areaRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!data || !chartRef.current || !candleRef.current || !areaRef.current || !volumeRef.current) return;

    candleRef.current.setData(data.candles);
    areaRef.current.setData(data.candles.map((item) => ({ time: item.time, value: item.close })));
    volumeRef.current.setData(data.volume);
    candleRef.current.applyOptions({ visible: chartType === "candles" });
    areaRef.current.applyOptions({ visible: chartType === "area" });
    chartRef.current.timeScale().fitContent();
    setMeasurement(null);
  }, [data, chartType]);

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
    if (!data || !containerRef.current || !chartRef.current || !candleRef.current || !areaRef.current) return null;

    const bounds = containerRef.current.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left, 0, bounds.width);
    const y = clamp(event.clientY - bounds.top, 0, bounds.height);
    const series = chartType === "area" ? areaRef.current : candleRef.current;
    const price = Number(series.coordinateToPrice(y));
    const logical = chartRef.current.timeScale().coordinateToLogical(x);

    if (!Number.isFinite(price) || logical === null) return null;

    const index = clamp(Math.round(Number(logical)), 0, Math.max(data.candles.length - 1, 0));
    const candle = data.candles[index];
    if (!candle) return null;

    return {
      x,
      y,
      price,
      index,
      time: candle.time
    };
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
      <div className="absolute left-3 top-3 z-10 inline-grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-[#071019]/88 p-1 text-xs font-black shadow-[0_12px_34px_rgba(0,0,0,.35)] backdrop-blur-md">
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
      </div>
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
