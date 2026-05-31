"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { enrichHolding, createHolding } from "@/lib/portfolio";
import { drawdownRanges } from "@/lib/market";
import { currencyFormat, percentFormat } from "@/lib/format";
import type { Holding, HoldingWithMarket } from "@/types/portfolio";
import type { DrawdownRange, MarketData } from "@/types/market";

const storageKey = "fin-port-holdings-v1";
const starterHoldings: Holding[] = [
  { id: "starter-aapl", symbol: "AAPL", quantity: 8, buyPrice: 185 },
  { id: "starter-btc", symbol: "BTC-USD", quantity: 0.08, buyPrice: 59000 },
  { id: "starter-gold", symbol: "GC=F", quantity: 1, buyPrice: 2300 }
];

export function PortfolioDashboard() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [rows, setRows] = useState<HoldingWithMarket[]>([]);
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [drawdownLimit, setDrawdownLimit] = useState("12");
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>("1y");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    setHoldings(stored ? JSON.parse(stored) : starterHoldings);
  }, []);

  useEffect(() => {
    if (holdings.length) window.localStorage.setItem(storageKey, JSON.stringify(holdings));
    refreshRows(holdings, drawdownRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, drawdownRange]);

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

  async function fetchMarket(symbolInput: string, topRange = drawdownRange) {
    const url = new URL("/api/market", window.location.origin);
    url.searchParams.set("symbol", symbolInput);
    url.searchParams.set("range", "1y");
    url.searchParams.set("drawdownRange", topRange);
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to fetch market data");
    return payload as MarketData;
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

  function addHolding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const qty = Number(quantity);
    const price = Number(buyPrice);
    if (!symbol.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return;
    setHoldings((current) => [createHolding(symbol, qty, price), ...current]);
    setSymbol("");
    setQuantity("");
    setBuyPrice("");
  }

  function removeHolding(id: string) {
    setHoldings((current) => current.filter((holding) => holding.id !== id));
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <article className="glass-panel overflow-hidden rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">My Portfolio</p>
          <h1 className="max-w-4xl font-serif text-5xl leading-none md:text-7xl">Net worth radar for every position.</h1>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <Summary title="Net Worth" value={currencyFormat(totals.marketValue)} />
            <Summary title="Cost Basis" value={currencyFormat(totals.costBasis)} />
            <Summary title="Total P/L" value={`${currencyFormat(totals.profitLoss)} ${percentFormat(pnlPercent)}`} tone={totals.profitLoss >= 0 ? "text-mint-signal" : "text-rose-signal"} />
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
          <h2 className="mb-4 text-2xl font-black">Add stock to port</h2>
          <form onSubmit={addHolding} className="grid gap-3">
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Symbol</span>
              <input id="holding-symbol" name="holdingSymbol" className="bg-transparent text-lg outline-none" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="AAPL" />
            </label>
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Quantity</span>
              <input id="holding-quantity" name="holdingQuantity" className="bg-transparent text-lg outline-none" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="10" />
            </label>
            <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Buy price</span>
              <input id="holding-buy-price" name="holdingBuyPrice" className="bg-transparent text-lg outline-none" type="number" min="0" step="0.01" value={buyPrice} onChange={(event) => setBuyPrice(event.target.value)} placeholder="185.00" />
            </label>
            <button className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e]">Add holding</button>
          </form>
          <button onClick={() => refreshRows(holdings, drawdownRange)} className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-slate-300 hover:text-white">
            {loading ? "Refreshing..." : "Refresh prices"}
          </button>
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
                  <th className="px-6 py-4">Symbol</th>
                  <th className="px-6 py-4">Qty</th>
                  <th className="px-6 py-4">Buy</th>
                  <th className="px-6 py-4">Now</th>
                  <th className="px-6 py-4">Value</th>
                  <th className="px-6 py-4">P/L</th>
                  <th className="px-6 py-4">From Top</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white/10">
                    <td className="px-6 py-4">
                      <strong className="block">{row.symbol}</strong>
                      <small className="text-slate-400">{row.name}</small>
                    </td>
                    <td className="px-6 py-4">{row.quantity}</td>
                    <td className="px-6 py-4">{currencyFormat(row.buyPrice, row.currency)}</td>
                    <td className="px-6 py-4">{currencyFormat(row.currentPrice, row.currency)}</td>
                    <td className="px-6 py-4 font-black">{currencyFormat(row.marketValue, row.currency)}</td>
                    <td className={`px-6 py-4 font-black ${row.profitLoss >= 0 ? "text-mint-signal" : "text-rose-signal"}`}>
                      {currencyFormat(row.profitLoss, row.currency)} {percentFormat(row.profitLossPercent)}
                    </td>
                    <td className={`px-6 py-4 font-black ${Math.abs(row.drawdownPercent) >= Number(drawdownLimit || 0) ? "text-amber-signal" : "text-slate-300"}`}>
                      {percentFormat(row.drawdownPercent)}
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => removeHolding(row.id)} className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-400 hover:text-white">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
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
