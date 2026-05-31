"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi
} from "lightweight-charts";
import type { MarketData } from "@/types/market";

type MarketChartProps = {
  data: MarketData | null;
  chartType: "candles" | "area";
};

export function MarketChart({ data, chartType }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

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
  }, [data, chartType]);

  return <div ref={containerRef} className="h-[420px] min-h-[360px] md:h-[548px]" />;
}
