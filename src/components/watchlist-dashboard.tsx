"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { drawdownRanges, fallbackMarketData, normalizeSymbol } from "@/lib/market";
import { toMarketSignal } from "@/lib/analytics";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { DrawdownRange, MarketData } from "@/types/market";
import { SymbolChartModal } from "./symbol-chart-modal";
import { SignalCell } from "./market-analysis";

const fallbackSymbols = ["AAPL", "MSFT", "NVDA", "VOO", "BTC-USD", "GC=F"];

type WatchlistRow = MarketData & {
  requestSymbol: string;
};

type SortKey = "symbol" | "price" | "changePercent" | "rangeChange" | "drawdownPercent" | "previousTop" | "signal";
type SortDirection = "asc" | "desc";
type WatchlistSort = {
  key: SortKey;
  direction: SortDirection;
};

type DisplayCurrency = "USD" | "THB";

type UsdThbRate = {
  rate: number;
  period: string;
  source: string;
};

type WatchlistWriteResponse = {
  symbol: string;
  symbols: string[];
};

const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "price", label: "Now" },
  { key: "changePercent", label: "Day" },
  { key: "rangeChange", label: "1Y Move" },
  { key: "drawdownPercent", label: "From Top" },
  { key: "previousTop", label: "Top" },
  { key: "signal", label: "Signal" }
];

export function WatchlistDashboard({ defaultSymbols }: { defaultSymbols: string[] }) {
  const seededSymbols = useMemo(() => uniqueSymbols(defaultSymbols.length ? defaultSymbols : fallbackSymbols), [defaultSymbols]);
  const [watchlistSeed, setWatchlistSeed] = useState(seededSymbols);
  const [symbols, setSymbols] = useState<string[]>(seededSymbols);
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [sort, setSort] = useState<WatchlistSort | null>(null);
  const [symbol, setSymbol] = useState("");
  const [drawdownLimit, setDrawdownLimit] = useState("12");
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>("1y");
  const [loading, setLoading] = useState(false);
  const [savingSymbol, setSavingSymbol] = useState(false);
  const [removingSymbol, setRemovingSymbol] = useState("");
  const [watchlistError, setWatchlistError] = useState("");
  const [chartRow, setChartRow] = useState<WatchlistRow | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const [usdThbRate, setUsdThbRate] = useState<UsdThbRate | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState("");

  useEffect(() => {
    setWatchlistSeed(seededSymbols);
    setSymbols(seededSymbols);
    setBootstrapped(true);
  }, [seededSymbols]);

  useEffect(() => {
    if (!bootstrapped) return;
    refreshRows(symbols, drawdownRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, drawdownRange, bootstrapped]);

  const summary = useMemo(() => {
    const positive = rows.filter((row) => row.changePercent >= 0).length;
    const flagged = rows.filter((row) => Math.abs(row.drawdownPercent) >= Number(drawdownLimit || 0)).length;
    const averageDrawdown = rows.length ? rows.reduce((sum, row) => sum + row.drawdownPercent, 0) / rows.length : 0;
    const worstDrawdown = rows.reduce<WatchlistRow | null>((worst, row) => {
      if (!worst) return row;
      return row.drawdownPercent < worst.drawdownPercent ? row : worst;
    }, null);

    return { positive, flagged, averageDrawdown, worstDrawdown };
  }, [drawdownLimit, rows]);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;

    return [...rows].sort((first, second) => {
      const firstValue = getSortValue(first, sort.key);
      const secondValue = getSortValue(second, sort.key);
      const direction = sort.direction === "asc" ? 1 : -1;

      if (typeof firstValue === "string" && typeof secondValue === "string") {
        return firstValue.localeCompare(secondValue) * direction;
      }

      return (Number(firstValue) - Number(secondValue)) * direction;
    });
  }, [rows, sort]);

  async function fetchMarket(symbolInput: string, topRange = drawdownRange) {
    const url = new URL("/api/market", window.location.origin);
    url.searchParams.set("symbol", symbolInput);
    url.searchParams.set("range", "1y");
    url.searchParams.set("drawdownRange", topRange);
    try {
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to fetch market data");
      return payload as MarketData;
    } catch {
      return fallbackMarketData(symbolInput, "1y", topRange);
    }
  }

  async function refreshRows(nextSymbols = symbols, topRange = drawdownRange) {
    if (!nextSymbols.length) {
      setRows([]);
      return;
    }

    setLoading(true);
    try {
      const markets = await Promise.all(nextSymbols.map((item) => fetchMarket(item, topRange)));
      setRows(markets.map((market, index) => ({ ...market, requestSymbol: nextSymbols[index] })));
    } finally {
      setLoading(false);
    }
  }

  async function addSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) {
      setWatchlistError("Symbol is required.");
      return;
    }

    setSavingSymbol(true);
    setWatchlistError("");

    try {
      const response = await fetch("/api/watchlist/my-watchlist", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          symbol: cleanSymbol
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the watchlist");

      const { symbols: nextSymbols } = payload as WatchlistWriteResponse;
      setWatchlistSeed(nextSymbols);
      setSymbols(nextSymbols);
      setSymbol("");
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : "Unable to save the watchlist");
    } finally {
      setSavingSymbol(false);
    }
  }

  async function removeSymbol(symbolToRemove: string) {
    setRemovingSymbol(symbolToRemove);
    setWatchlistError("");

    try {
      const response = await fetch("/api/watchlist/my-watchlist", {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          symbol: symbolToRemove
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the watchlist");

      const { symbols: nextSymbols } = payload as WatchlistWriteResponse;
      setWatchlistSeed(nextSymbols);
      setSymbols(nextSymbols);
      setRows((current) => current.filter((row) => normalizeSymbol(row.requestSymbol) !== normalizeSymbol(symbolToRemove)));
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : "Unable to save the watchlist");
    } finally {
      setRemovingSymbol("");
    }
  }

  function resetWatchlist() {
    setSymbols(watchlistSeed);
  }

  function openSymbolChart(row: WatchlistRow) {
    setChartRow(row);
  }

  function changeSort(key: SortKey) {
    setSort((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }

      return { key, direction: key === "symbol" ? "asc" : "desc" };
    });
  }

  async function toggleThbDisplay() {
    if (displayCurrency === "THB") {
      setDisplayCurrency("USD");
      setFxError("");
      return;
    }

    setFxLoading(true);
    setFxError("");
    try {
      const response = await fetch("/api/exchange-rate/usd-thb");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load USD/THB exchange rate");
      setUsdThbRate(payload as UsdThbRate);
      setDisplayCurrency("THB");
    } catch (error) {
      setFxError(error instanceof Error ? error.message : "Unable to load USD/THB exchange rate");
    } finally {
      setFxLoading(false);
    }
  }

  function formatMoney(value: number, currency = "USD") {
    return formatDisplayMoney(value, currency, displayCurrency, usdThbRate?.rate);
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <article className="glass-panel overflow-hidden rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">My Watchlist</p>
          <h1 className="max-w-4xl font-serif text-5xl leading-none md:text-7xl">Price radar without position sizing.</h1>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <Summary title="Symbols" value={String(rows.length)} />
            <Summary title="Green Today" value={`${summary.positive}/${rows.length || 0}`} tone="text-mint-signal" />
            <Summary title="Avg Drawdown" value={percentFormat(summary.averageDrawdown)} tone="text-amber-signal" />
          </div>
        </article>

        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Drawdown Detector</p>
          <h2 className="mb-4 text-2xl font-black">Watchlist top % alert</h2>
          <label className="field-shell mb-4 grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Flag symbols down by %</span>
            <input id="watchlist-drawdown-limit" name="watchlistDrawdownLimit" className="bg-transparent text-xl outline-none" type="number" min="0" step="0.1" value={drawdownLimit} onChange={(event) => setDrawdownLimit(event.target.value)} />
          </label>
          <label className="field-shell mb-4 grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Previous top window</span>
            <select
              id="watchlist-drawdown-range"
              name="watchlistDrawdownRange"
              className="bg-transparent text-xl outline-none"
              value={drawdownRange}
              onChange={(event) => setDrawdownRange(event.target.value as DrawdownRange)}
            >
              {drawdownRanges.map((item) => (
                <option className="bg-panel" key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <strong className={summary.flagged ? "text-amber-signal" : "text-mint-signal"}>
              {summary.flagged ? `${summary.flagged} symbol${summary.flagged > 1 ? "s" : ""} flagged` : "No drawdown breach"}
            </strong>
            <p className="mt-1 text-sm text-slate-400">
              Worst: {summary.worstDrawdown ? `${summary.worstDrawdown.symbol} ${percentFormat(summary.worstDrawdown.drawdownPercent)}` : "none"}
            </p>
          </div>
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-[390px_1fr]">
        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Watchlist Input</p>
          <h2 className="mb-4 text-2xl font-black">Add symbol</h2>
          <form onSubmit={addSymbol} className="grid gap-3">
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Symbol</span>
              <input id="watchlist-symbol" name="watchlistSymbol" className="bg-transparent text-lg outline-none" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="AAPL" />
            </label>
            <button disabled={savingSymbol} className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e] disabled:cursor-not-allowed disabled:opacity-60">
              {savingSymbol ? "Saving..." : "Add to watchlist"}
            </button>
          </form>
          {watchlistError && <p className="mt-3 text-sm text-rose-signal">{watchlistError}</p>}
          <button type="button" onClick={() => refreshRows(symbols, drawdownRange)} className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-slate-300 hover:text-white">
            {loading ? "Refreshing..." : "Refresh prices"}
          </button>
          <button type="button" onClick={resetWatchlist} className="mt-3 w-full rounded-2xl border border-cyan-signal/25 bg-cyan-signal/10 px-4 py-3 font-bold text-cyan-signal hover:text-white">
            Reset watchlist
          </button>
          <button type="button" onClick={toggleThbDisplay} className="mt-3 w-full rounded-2xl border border-amber-signal/30 bg-amber-signal/10 px-4 py-3 font-bold text-amber-signal hover:text-white">
            {fxLoading ? "Loading BOT rate..." : displayCurrency === "THB" ? "Show USD" : "Convert USD to THB"}
          </button>
          {usdThbRate && (
            <p className="mt-3 text-sm text-slate-400">
              USD/THB {usdThbRate.rate.toFixed(4)} from {usdThbRate.source}, {usdThbRate.period}.
            </p>
          )}
          {fxError && <p className="mt-3 text-sm text-rose-signal">{fxError}</p>}
        </section>

        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="border-b border-white/10 p-6">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Symbols</p>
            <h2 className="text-2xl font-black">Watchlist table</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] border-collapse text-left">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  {sortableColumns.map((column) => (
                    <th
                      key={column.key}
                      className="px-6 py-4"
                      aria-sort={sort?.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => changeSort(column.key)}
                        className="inline-flex min-h-8 items-center gap-2 rounded-full border border-transparent px-2 text-left font-black text-slate-400 transition hover:border-white/10 hover:bg-white/5 hover:text-white"
                      >
                        <span>{column.label}</span>
                        <span className={sort?.key === column.key ? "text-cyan-signal" : "text-slate-600"}>
                          {sort?.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.requestSymbol} className="border-t border-white/10">
                    <td className="px-6 py-4">
                      <button type="button" onClick={() => openSymbolChart(row)} className="block text-left font-black text-white underline-offset-4 hover:text-cyan-signal hover:underline">
                        {row.symbol}
                      </button>
                      <small className="text-slate-400">{row.name}</small>
                    </td>
                    <td className="px-6 py-4 font-black">{formatMoney(row.price, row.currency)}</td>
                    <td className={`px-6 py-4 font-black ${row.changePercent >= 0 ? "text-mint-signal" : "text-rose-signal"}`}>
                      {formatMoney(row.change, row.currency)} {percentFormat(row.changePercent)}
                    </td>
                    <td className={`px-6 py-4 font-black ${row.rangeChange >= 0 ? "text-mint-signal" : "text-rose-signal"}`}>
                      {percentFormat(row.rangeChange)}
                    </td>
                    <td className={`px-6 py-4 font-black ${Math.abs(row.drawdownPercent) >= Number(drawdownLimit || 0) ? "text-amber-signal" : "text-slate-300"}`}>
                      {percentFormat(row.drawdownPercent)}
                    </td>
                    <td className="px-6 py-4">{formatMoney(row.previousTop, row.currency)}</td>
                    <td className="px-6 py-4">
                      <SignalCell signal={toMarketSignal(row.analytics)} />
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => removeSymbol(row.requestSymbol)}
                        disabled={isPendingSymbol(removingSymbol, row.requestSymbol)}
                        className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isPendingSymbol(removingSymbol, row.requestSymbol) ? "Removing..." : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
      {chartRow && (
        <SymbolChartModal
          symbol={chartRow.symbol}
          seed={chartRow}
          drawdownRange={drawdownRange}
          onClose={() => setChartRow(null)}
        />
      )}
    </div>
  );
}

function Summary({ title, value, tone = "text-white" }: { title: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</span>
      <strong className={`mt-2 block text-2xl font-black ${tone}`}>{value}</strong>
    </div>
  );
}

function uniqueSymbols(symbols: string[]) {
  return Array.from(new Set(symbols.map((item) => normalizeSymbol(item)).filter(Boolean)));
}

function isPendingSymbol(pendingSymbol: string, rowSymbol: string) {
  return Boolean(pendingSymbol) && normalizeSymbol(pendingSymbol) === normalizeSymbol(rowSymbol);
}

function getSortValue(row: WatchlistRow, key: SortKey) {
  if (key === "symbol") return row.symbol;
  if (key === "signal") return row.analytics.verdict.score;
  return row[key];
}

function formatDisplayMoney(value: number, sourceCurrency: string, displayCurrency: DisplayCurrency, usdThbRate?: number) {
  if (displayCurrency === "THB" && sourceCurrency === "USD" && usdThbRate) {
    return currencyFormat(value * usdThbRate, "THB");
  }

  return currencyFormat(value, sourceCurrency);
}
