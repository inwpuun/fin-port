"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { drawdownRanges, fallbackMarketData } from "@/lib/market";
import { currencyFormat, percentFormat, plainPrice } from "@/lib/format";
import type { DrawdownRange, MarketData } from "@/types/market";
import { MarketChart } from "./market-chart";

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
  const [range, setRange] = useState("6mo");
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>("1y");
  const [data, setData] = useState<MarketData | null>(null);
  const [chartType, setChartType] = useState<"candles" | "area">("area");
  const [events, setEvents] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [priceAlert, setPriceAlert] = useState("");
  const [drawdownAlert, setDrawdownAlert] = useState("10");
  const [armedPrice, setArmedPrice] = useState<{ symbol: string; value: number; triggered: boolean } | null>(null);
  const [armedDrawdown, setArmedDrawdown] = useState<{ symbol: string; value: number; triggered: boolean } | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [watchlist, setWatchlist] = useState(quickSymbols);
  const [watchlistSaving, setWatchlistSaving] = useState(false);

  const alertStatus = useMemo(() => {
    if (armedPrice?.triggered || armedDrawdown?.triggered) return "Triggered";
    if (armedPrice || armedDrawdown) return "Armed";
    return "Idle";
  }, [armedDrawdown, armedPrice]);
  const chartLabel = `${data?.symbol || "AAPL"} ${chartType === "candles" ? "candles + volume" : "signal line + volume"}`;

  function addEvent(title: string, body: string) {
    setEvents((current) => [{ id: crypto.randomUUID(), title, body }, ...current].slice(0, 10));
  }

  function notify(title: string, body: string) {
    addEvent(title, body);
    if (notifyEnabled && "Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
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
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to fetch market data");
      setData(payload);
      setSymbol(payload.symbol);
      addEvent("Market loaded", `${payload.symbol} updated from ${payload.source}.`);
    } catch (error) {
      const fallback = fallbackMarketData(cleanSymbol, nextRange, nextDrawdownRange);
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

  function evaluateAlerts(market: MarketData) {
    if (armedPrice && armedPrice.symbol === market.symbol && !armedPrice.triggered && market.price <= armedPrice.value) {
      setArmedPrice({ ...armedPrice, triggered: true });
      notify(
        `${market.symbol} price drop`,
        `${market.name} is ${currencyFormat(market.price, market.currency)}, below ${plainPrice(armedPrice.value)}.`
      );
    }

    if (
      armedDrawdown &&
      armedDrawdown.symbol === market.symbol &&
      !armedDrawdown.triggered &&
      Math.abs(market.drawdownPercent) >= armedDrawdown.value
    ) {
      setArmedDrawdown({ ...armedDrawdown, triggered: true });
      notify(
        `${market.symbol} drawdown alert`,
        `${market.name} is ${percentFormat(market.drawdownPercent)} from its ${market.drawdownLabel} top.`
      );
    }
  }

  useEffect(() => {
    loadMarket("AAPL", "6mo", "1y");
    loadSavedWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (data) evaluateAlerts(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, armedPrice, armedDrawdown]);

  async function toggleNotifications(enabled: boolean) {
    if (!enabled) {
      setNotifyEnabled(false);
      return;
    }
    if (!("Notification" in window)) {
      addEvent("Notification unavailable", "This browser does not support desktop notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotifyEnabled(permission === "granted");
    addEvent(
      permission === "granted" ? "Notifications enabled" : "Notifications blocked",
      permission === "granted" ? "Desktop alerts are active while this page is open." : "Browser permission was not granted."
    );
  }

  function submitSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadMarket(symbol, range);
  }

  function armAlerts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const priceValue = Number(priceAlert);
    const drawdownValue = Number(drawdownAlert);

    if (Number.isFinite(priceValue) && priceValue > 0) {
      setArmedPrice({ symbol: data.symbol, value: priceValue, triggered: false });
      addEvent("Price alert armed", `${data.symbol} will trigger at or below ${plainPrice(priceValue)}.`);
    }
    if (Number.isFinite(drawdownValue) && drawdownValue > 0) {
      setArmedDrawdown({ symbol: data.symbol, value: drawdownValue, triggered: false });
      addEvent("Drawdown alert armed", `${data.symbol} will trigger at ${drawdownValue}% below the ${data.drawdownLabel} top.`);
    }
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

  return (
    <div className={loading ? "animate-glow" : ""}>
      <section className="glass-panel mb-4 rounded-3xl p-3">
        <form onSubmit={submitSymbol} className="grid gap-2 md:grid-cols-[1fr_120px_56px]">
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
                setRange(event.target.value);
                loadMarket(symbol, event.target.value, drawdownRange);
              }}
              aria-label="Chart range"
            >
              <option className="bg-panel" value="1mo">1M</option>
              <option className="bg-panel" value="3mo">3M</option>
              <option className="bg-panel" value="6mo">6M</option>
              <option className="bg-panel" value="1y">1Y</option>
              <option className="bg-panel" value="5y">5Y</option>
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
        <Metric title="Session Pulse" value={data && data.changePercent > 0 ? "Bid pressure" : data && data.changePercent < 0 ? "Offer pressure" : "Balanced"} note="last candle bias" />
        <Metric title="Range Move" value={data ? percentFormat(data.rangeChange) : "0.00%"} note="selected lookback" tone={data && data.rangeChange >= 0 ? "text-mint-signal" : "text-rose-signal"} />
        <Metric
          title="Drawdown"
          value={data ? percentFormat(data.drawdownPercent) : "0.00%"}
          note={`${data?.drawdownLabel || "1 year"} top ${data ? currencyFormat(data.previousTop, data.currency) : "$0"}`}
          tone="text-amber-signal"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Live Chart</p>
              <h2 className="text-xl font-black">{chartLabel}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setChartType("candles")} className={chipClass(chartType === "candles")}>Candles</button>
              <button onClick={() => setChartType("area")} className={chipClass(chartType === "area")}>Signal</button>
              <button onClick={() => loadMarket(symbol, range, drawdownRange)} className={chipClass(false)}>Refresh</button>
            </div>
          </div>
          <MarketChart data={data} chartType={chartType} />
          <div className="flex flex-col gap-2 border-t border-white/10 px-5 py-4 text-sm text-slate-400 md:flex-row md:justify-between">
            <span>Source: {data?.source || "loading"}</span>
            <span>Last candle: {data?.marketTime || "loading"}</span>
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <section className="glass-panel rounded-3xl p-5">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Notification</p>
            <h2 className="mb-4 text-xl font-black">Drop alert</h2>
            <form onSubmit={armAlerts} className="grid gap-3">
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Price at or below</span>
                <input id="price-alert" name="priceAlert" className="bg-transparent text-lg outline-none" type="number" min="0" step="0.01" placeholder={data ? plainPrice(data.price * 0.97) : "190"} value={priceAlert} onChange={(event) => setPriceAlert(event.target.value)} />
              </label>
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Down from previous top %</span>
                <input id="drawdown-alert" name="drawdownAlert" className="bg-transparent text-lg outline-none" type="number" min="0" step="0.1" value={drawdownAlert} onChange={(event) => setDrawdownAlert(event.target.value)} />
              </label>
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Previous top window</span>
                <select
                  id="drawdown-range"
                  name="drawdownRange"
                  className="bg-transparent text-lg outline-none"
                  value={drawdownRange}
                  onChange={(event) => {
                    const nextRange = event.target.value as DrawdownRange;
                    setDrawdownRange(nextRange);
                    loadMarket(symbol, range, nextRange);
                  }}
                >
                  {drawdownRanges.map((item) => (
                    <option className="bg-panel" key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 text-slate-400">
                <input id="browser-notification" name="browserNotification" type="checkbox" checked={notifyEnabled} onChange={(event) => toggleNotifications(event.target.checked)} />
                Browser notification
              </label>
              <button className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e]">Arm alerts</button>
            </form>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-slate-400">
              <span>Alert state</span>
              <strong className="text-white">{alertStatus}</strong>
            </div>
          </section>

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
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Signal Log</p>
            <h2 className="mb-4 text-xl font-black">Events</h2>
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
