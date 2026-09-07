"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createHoldingFromPortfolioSeed, enrichHolding } from "@/lib/portfolio";
import { drawdownRanges, fallbackMarketData, normalizeSymbol } from "@/lib/market";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { AllocationRule, Holding, HoldingWithMarket, PortfolioSeed } from "@/types/portfolio";
import type { DrawdownRange, MarketData } from "@/types/market";
import { SymbolChartModal } from "./symbol-chart-modal";
import {
  HoldingEditorModal,
  type HoldingEditorSave,
  type HoldingEditorTarget
} from "./holding-editor-modal";

type SortKey = "symbol" | "quantity" | "buyPrice" | "currentPrice" | "marketValue" | "profitLoss" | "drawdownPercent";
type SortDirection = "asc" | "desc";
type PortfolioSort = {
  key: SortKey;
  direction: SortDirection;
};

type DisplayCurrency = "USD" | "THB";
type ChartType = "candles" | "area";

type UsdThbRate = {
  rate: number;
  period: string;
  source: string;
};

type PortfolioWriteResponse = {
  seed: PortfolioSeed;
  portfolio: PortfolioSeed[];
  market: MarketData;
};

type PortfolioDeleteResponse = {
  allocationRules?: AllocationRule[];
  stock: string;
  portfolio: PortfolioSeed[];
};

const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "quantity", label: "Qty" },
  { key: "buyPrice", label: "Buy" },
  { key: "currentPrice", label: "Now" },
  { key: "marketValue", label: "Value" },
  { key: "profitLoss", label: "P/L" },
  { key: "drawdownPercent", label: "From Top" }
];

export function PortfolioDashboard({
  defaultPortfolio,
  allocationRules: initialAllocationRules = []
}: {
  defaultPortfolio: PortfolioSeed[];
  allocationRules?: AllocationRule[];
}) {
  const [portfolioSeed, setPortfolioSeed] = useState(defaultPortfolio);
  const [allocationRules, setAllocationRules] = useState(initialAllocationRules);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<HoldingEditorTarget | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [rows, setRows] = useState<HoldingWithMarket[]>([]);
  const [sort, setSort] = useState<PortfolioSort | null>(null);
  const [symbol, setSymbol] = useState("");
  const [holdingValue, setHoldingValue] = useState("");
  const [profitPercent, setProfitPercent] = useState("");
  const [drawdownLimit, setDrawdownLimit] = useState("12");
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>("1y");
  const [loading, setLoading] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [removingSymbol, setRemovingSymbol] = useState("");
  const [chartOpen, setChartOpen] = useState(false);
  const [chartMarket, setChartMarket] = useState<MarketData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [bootstrapped, setBootstrapped] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const [usdThbRate, setUsdThbRate] = useState<UsdThbRate | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState("");
  const skipNextRefresh = useRef(false);

  useEffect(() => {
    /*
     * Postgres is the source of truth, so always seed from the server.
     *
     * This used to read a localStorage cache first and return early if it
     * found one, which made the table permanently stale: open the app once
     * before the data was imported and the cache stored "[]", which is truthy,
     * so every later visit short-circuited on the empty array and never asked
     * the database again. localStorage is per-origin, so a poisoned Vercel
     * deployment kept showing nothing while localhost -- a different origin
     * with a good cache -- looked fine. It also meant edits saved to Postgres
     * could be shadowed by whatever the browser had kept.
     */
    // Drop the abandoned cache so a browser poisoned by the old build does
    // not keep a stale copy of the portfolio in storage forever.
    try {
      window.localStorage.removeItem("fin-port-holdings-v3");
    } catch {
      // Private mode or blocked storage: nothing to clean up.
    }

    materializeDefaultPortfolio(portfolioSeed, drawdownRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;
    if (skipNextRefresh.current) {
      skipNextRefresh.current = false;
      return;
    }
    refreshRows(holdings, drawdownRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, drawdownRange, bootstrapped]);

  const totals = useMemo(() => {
    return rows.reduce(
      (sum, row) => ({
        marketValue: sum.marketValue + row.marketValue,
        costBasis: sum.costBasis + row.costBasis,
        profitLoss: sum.profitLoss + row.profitLoss
      }),
      { marketValue: 0, costBasis: 0, profitLoss: 0 }
    );
  }, [rows]);

  const pnlPercent = totals.costBasis ? (totals.profitLoss / totals.costBasis) * 100 : 0;
  const drawdownBreaches = rows.filter((row) => Math.abs(row.drawdownPercent) >= Number(drawdownLimit || 0));
  const drawdownRangeLabel = drawdownRanges.find((item) => item.value === drawdownRange)?.label || "1 year";
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

  async function materializeDefaultPortfolio(seed: PortfolioSeed[], topRange = drawdownRange) {
    if (!seed.length) {
      setRows([]);
      setHoldings([]);
      setBootstrapped(true);
      return;
    }

    setLoading(true);
    try {
      const markets = await Promise.all(seed.map((item) => fetchMarket(item.symbol, topRange)));
      const convertedCostBases = await Promise.all(seed.map((item, index) => convertSeedCostBasis(item, markets[index], topRange)));
      const nextHoldings = seed.map((item, index) => createHoldingFromPortfolioSeed(item, markets[index], convertedCostBases[index]));
      const nextRows = nextHoldings.map((holding, index) => enrichHolding(holding, markets[index]));
      skipNextRefresh.current = true;
      setRows(nextRows);
      setHoldings(nextHoldings);
    } finally {
      setLoading(false);
      setBootstrapped(true);
    }
  }

  async function refreshRows(nextHoldings = holdings, topRange = drawdownRange) {
    if (!nextHoldings.length) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const markets = await Promise.all(nextHoldings.map((holding) => fetchMarket(holding.symbol, topRange)));
      setRows(nextHoldings.map((holding, index) => enrichHolding(holding, markets[index])));
    } finally {
      setLoading(false);
    }
  }

  async function addHolding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(holdingValue);
    const profit = Number(profitPercent);

    if (!symbol.trim() || !Number.isFinite(value) || value <= 0 || !Number.isFinite(profit) || profit <= -100) {
      setAddError("Enter a stock, holding value greater than 0, and % profit greater than -100.");
      return;
    }

    setAddSaving(true);
    setAddError("");

    try {
      const response = await fetch("/api/portfolio/my-port", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          stock: symbol,
          holdingValue: value,
          profitPercent: profit
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the holding");

      const { seed, portfolio, market } = payload as PortfolioWriteResponse;
      const holding = createHoldingFromPortfolioSeed(seed, market, seed.costBasis);
      const row = enrichHolding(holding, market);

      skipNextRefresh.current = true;
      setPortfolioSeed(portfolio);
      setHoldings((current) => upsertBySymbol(current, holding));
      setRows((current) => upsertBySymbol(current, row));
      setSymbol("");
      setHoldingValue("");
      setProfitPercent("");
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Unable to save the holding");
    } finally {
      setAddSaving(false);
    }
  }

  const categories = useMemo(
    () => [...new Set(allocationRules.map((rule) => rule.category))].sort(),
    [allocationRules]
  );

  const categoryBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    allocationRules.forEach((rule) => map.set(normalizeSymbol(rule.symbol), rule.category));
    return map;
  }, [allocationRules]);

  function openEditor(row?: HoldingWithMarket) {
    setEditorTarget(
      row
        ? {
            symbol: row.symbol,
            quantity: row.quantity,
            buyPrice: row.buyPrice,
            costCurrency: row.currency,
            category: categoryBySymbol.get(normalizeSymbol(row.symbol)) ?? ""
          }
        : null
    );
    setEditorOpen(true);
  }

  function onEditorSaved(result: HoldingEditorSave) {
    if (result.allocationRules) setAllocationRules(result.allocationRules);
    if (result.portfolio) {
      // Re-materialize from the saved seed so quantity, cost basis and every
      // derived market figure in the table come from what actually persisted.
      setPortfolioSeed(result.portfolio);
      materializeDefaultPortfolio(result.portfolio, drawdownRange);
    }
  }

  async function removeHolding(symbolToRemove: string) {
    setRemovingSymbol(symbolToRemove);
    setAddError("");

    try {
      const response = await fetch("/api/portfolio/my-port", {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          stock: symbolToRemove
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the holding");

      const { portfolio, allocationRules: nextRules } = payload as PortfolioDeleteResponse;
      if (nextRules) setAllocationRules(nextRules);
      const removedKey = normalizeSymbol(symbolToRemove);

      skipNextRefresh.current = true;
      setPortfolioSeed(portfolio);
      setHoldings((current) => current.filter((holding) => normalizeSymbol(holding.symbol) !== removedKey));
      setRows((current) => current.filter((row) => normalizeSymbol(row.symbol) !== removedKey));
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Unable to save the holding");
    } finally {
      setRemovingSymbol("");
    }
  }

  async function openSymbolChart(symbolInput: string) {
    setChartOpen(true);
    setChartMarket(null);
    setChartError("");
    setChartLoading(true);
    setChartType("area");

    try {
      const market = await fetchMarket(symbolInput, drawdownRange);
      setChartMarket(market);
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "Unable to load chart");
    } finally {
      setChartLoading(false);
    }
  }

  function changeSort(key: SortKey) {
    setSort((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }

      return { key, direction: key === "symbol" ? "asc" : "desc" };
    });
  }

  async function convertSeedCostBasis(seed: PortfolioSeed, market: MarketData, topRange = drawdownRange) {
    if (!Number.isFinite(seed.costBasis)) return undefined;

    const fromCurrency = seed.costCurrency || market.currency;
    if (fromCurrency === market.currency) return seed.costBasis;

    if (fromCurrency === "THB" && market.currency === "USD") {
      const fxMarket = await fetchMarket("THB=X", topRange);
      return fxMarket.price > 0 ? seed.costBasis! / fxMarket.price : seed.costBasis;
    }

    return seed.costBasis;
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
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">My Portfolio</p>
          <h1 className="max-w-4xl font-serif text-5xl leading-none md:text-7xl">Net worth radar for every position.</h1>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <Summary title="Net Worth" value={formatMoney(totals.marketValue)} />
            <Summary title="Cost Basis" value={formatMoney(totals.costBasis)} />
            <Summary title="Total P/L" value={`${formatMoney(totals.profitLoss)} ${percentFormat(pnlPercent)}`} tone={totals.profitLoss >= 0 ? "text-mint-signal" : "text-rose-signal"} />
          </div>
        </article>

        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Drawdown Detector</p>
          <h2 className="mb-4 text-2xl font-black">Previous top % alert</h2>
          <label className="field-shell mb-4 grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Flag positions down by %</span>
            <input id="portfolio-drawdown-limit" name="portfolioDrawdownLimit" className="bg-transparent text-xl outline-none" type="number" min="0" step="0.1" value={drawdownLimit} onChange={(event) => setDrawdownLimit(event.target.value)} />
          </label>
          <label className="field-shell mb-4 grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Previous top window</span>
            <select
              id="portfolio-drawdown-range"
              name="portfolioDrawdownRange"
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
            <strong className={drawdownBreaches.length ? "text-amber-signal" : "text-mint-signal"}>
              {drawdownBreaches.length ? `${drawdownBreaches.length} position${drawdownBreaches.length > 1 ? "s" : ""} flagged` : "No drawdown breach"}
            </strong>
            <p className="mt-1 text-sm text-slate-400">
              Measured from the highest candle in the selected {drawdownRangeLabel} window.
            </p>
          </div>
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-[390px_1fr]">
        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Holding Input</p>
          <h2 className="mb-4 text-2xl font-black">Add stock to portfolio</h2>
          <button
            type="button"
            onClick={() => openEditor()}
            className="mb-4 min-h-12 w-full rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e]"
          >
            Add by quantity and buy price
          </button>
          <p className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">
            or enter a holding value
          </p>
          <form onSubmit={addHolding} className="grid gap-3">
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Symbol</span>
              <input id="holding-symbol" name="holdingSymbol" className="bg-transparent text-lg outline-none" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="AAPL" />
            </label>
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Holding value</span>
              <input id="holding-value" name="holdingValue" className="bg-transparent text-lg outline-none" type="number" min="0" step="0.01" value={holdingValue} onChange={(event) => setHoldingValue(event.target.value)} placeholder="1000.00" />
            </label>
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">% profit</span>
              <input id="holding-profit-percent" name="holdingProfitPercent" className="bg-transparent text-lg outline-none" type="number" min="-99.99" step="0.01" value={profitPercent} onChange={(event) => setProfitPercent(event.target.value)} placeholder="12.5" />
            </label>
            <button disabled={addSaving} className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e] disabled:cursor-not-allowed disabled:opacity-60">
              {addSaving ? "Saving..." : "Add holding"}
            </button>
          </form>
          {addError && <p className="mt-3 text-sm text-rose-signal">{addError}</p>}
          <button type="button" onClick={() => refreshRows(holdings, drawdownRange)} className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-slate-300 hover:text-white">
            {loading ? "Refreshing..." : "Refresh prices"}
          </button>
          <button type="button" onClick={() => materializeDefaultPortfolio(portfolioSeed, drawdownRange)} className="mt-3 w-full rounded-2xl border border-cyan-signal/25 bg-cyan-signal/10 px-4 py-3 font-bold text-cyan-signal hover:text-white">
            Reload from database
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
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Positions</p>
            <h2 className="text-2xl font-black">Holdings table</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
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
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id} className="border-t border-white/10">
                    <td className="px-6 py-4">
                      <button type="button" onClick={() => openSymbolChart(row.symbol)} className="block text-left font-black text-white underline-offset-4 hover:text-cyan-signal hover:underline">
                        {row.symbol}
                      </button>
                      <small className="text-slate-400">{row.name}</small>
                    </td>
                    <td className="px-6 py-4">{quantityFormat(row.quantity)}</td>
                    <td className="px-6 py-4">{formatMoney(row.buyPrice, row.currency)}</td>
                    <td className="px-6 py-4">{formatMoney(row.currentPrice, row.currency)}</td>
                    <td className="px-6 py-4 font-black">{formatMoney(row.marketValue, row.currency)}</td>
                    <td className={`px-6 py-4 font-black ${row.profitLoss >= 0 ? "text-mint-signal" : "text-rose-signal"}`}>
                      {formatMoney(row.profitLoss, row.currency)} {percentFormat(row.profitLossPercent)}
                    </td>
                    <td className={`px-6 py-4 font-black ${Math.abs(row.drawdownPercent) >= Number(drawdownLimit || 0) ? "text-amber-signal" : "text-slate-300"}`}>
                      {percentFormat(row.drawdownPercent)}
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {categoryBySymbol.get(normalizeSymbol(row.symbol)) ?? (
                        <span className="text-slate-600">unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditor(row)}
                          className="rounded-full border border-cyan-signal/30 bg-cyan-signal/10 px-3 py-1 text-sm font-bold text-cyan-signal transition hover:text-white"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeHolding(row.symbol)}
                          disabled={isPendingSymbol(removingSymbol, row.symbol)}
                          className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isPendingSymbol(removingSymbol, row.symbol) ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
      {editorOpen && (
        <HoldingEditorModal
          target={editorTarget}
          categories={categories}
          onClose={() => setEditorOpen(false)}
          onSaved={onEditorSaved}
        />
      )}
      {chartOpen && (
        <SymbolChartModal
          chartType={chartType}
          data={chartMarket}
          error={chartError}
          loading={chartLoading}
          onChartTypeChange={setChartType}
          onClose={() => setChartOpen(false)}
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

function quantityFormat(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1 ? 4 : 8
  }).format(value);
}

function getSortValue(row: HoldingWithMarket, key: SortKey) {
  if (key === "symbol") return row.symbol;
  return row[key];
}

function isPendingSymbol(pendingSymbol: string, rowSymbol: string) {
  return Boolean(pendingSymbol) && normalizeSymbol(pendingSymbol) === normalizeSymbol(rowSymbol);
}

function upsertBySymbol<T extends { symbol: string }>(items: T[], next: T) {
  const nextKey = normalizeSymbol(next.symbol);
  return [next, ...items.filter((item) => normalizeSymbol(item.symbol) !== nextKey)];
}

function formatDisplayMoney(value: number, sourceCurrency: string, displayCurrency: DisplayCurrency, usdThbRate?: number) {
  if (displayCurrency === "THB" && sourceCurrency === "USD" && usdThbRate) {
    return currencyFormat(value * usdThbRate, "THB");
  }

  return currencyFormat(value, sourceCurrency);
}
