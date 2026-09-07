"use client";

import { useEffect, useMemo, useState } from "react";
import { fallbackMarketData } from "@/lib/market";
import { currencyFormat } from "@/lib/format";
import type { MarketData } from "@/types/market";
import type { AllocationRule, PortfolioSeed } from "@/types/portfolio";
import {
  HoldingEditorModal,
  type HoldingEditorSave,
  type HoldingEditorTarget
} from "./holding-editor-modal";

type DisplayCurrency = "USD" | "THB";

type UsdThbRate = {
  rate: number;
  period: string;
  source: string;
};

type AllocationPosition = {
  category: string;
  symbol: string;
  value: number;
  source: "portfolio" | "cash" | "missing" | "unassigned";
};

type AllocationGroup = {
  category: string;
  value: number;
  symbols: string[];
  color: string;
};

const UNASSIGNED_CATEGORY = "Unassigned";

const groupColors = ["#52d6ff", "#14ce99", "#ffcc66", "#ff5278", "#a78bfa", "#38bdf8", "#f97316", "#e5e7eb", "#94a3b8"];

export function AllocationDashboard({
  allocationRules: initialAllocationRules,
  portfolioSeed: initialPortfolioSeed
}: {
  allocationRules: AllocationRule[];
  portfolioSeed: PortfolioSeed[];
}) {
  const [allocationRules, setAllocationRules] = useState(initialAllocationRules);
  const [portfolioSeed, setPortfolioSeed] = useState(initialPortfolioSeed);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<HoldingEditorTarget | null>(null);
  const [positions, setPositions] = useState<AllocationPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const [usdThbRate, setUsdThbRate] = useState<UsdThbRate | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState("");

  useEffect(() => {
    calculateAllocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocationRules, portfolioSeed]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, AllocationGroup>();

    positions.forEach((position) => {
      const current = byCategory.get(position.category) || {
        // Blank for the placeholder lane, so saving cannot create a literal
      // "Unassigned" category in the database.
      category: position.category === UNASSIGNED_CATEGORY ? "" : position.category,
        value: 0,
        symbols: [],
        color: groupColors[byCategory.size % groupColors.length]
      };

      current.value += position.value;
      current.symbols.push(position.symbol);
      byCategory.set(position.category, current);
    });

    return Array.from(byCategory.values()).sort((first, second) => second.value - first.value);
  }, [positions]);

  const totalValue = groups.reduce((sum, group) => sum + group.value, 0);
  const largestGroup = groups[0];
  const missingPositions = positions.filter((position) => position.source === "missing");
  const unassignedPositions = positions.filter((position) => position.source === "unassigned");

  const categories = useMemo(
    () => [...new Set(allocationRules.map((rule) => rule.category))].sort(),
    [allocationRules]
  );

  function openEditor(position: AllocationPosition) {
    const rule = allocationRules.find(
      (item) => normalizeKey(item.symbol) === normalizeKey(position.symbol)
    );
    const seed = portfolioSeed.find(
      (item) => normalizeKey(item.symbol) === normalizeKey(position.symbol)
    );
    const quantity = seed?.quantity;
    const costBasis = seed?.costBasis;

    setEditorTarget({
      symbol: position.symbol,
      quantity,
      // The editor takes a unit price; the seed stores the position total.
      buyPrice: quantity && costBasis ? costBasis / quantity : undefined,
      costCurrency: seed?.costCurrency || "USD",
      // Blank for the placeholder lane, so saving cannot create a literal
      // "Unassigned" category in the database.
      category: position.category === UNASSIGNED_CATEGORY ? "" : position.category,
      cashValue: rule?.cashValue,
      cashCurrency: rule?.cashCurrency || "THB"
    });
    setEditorOpen(true);
  }

  function onEditorSaved(result: HoldingEditorSave) {
    if (result.allocationRules) setAllocationRules(result.allocationRules);
    if (result.portfolio) setPortfolioSeed(result.portfolio);
  }

  async function fetchMarket(symbolInput: string) {
    const url = new URL("/api/market", window.location.origin);
    url.searchParams.set("symbol", symbolInput);
    url.searchParams.set("range", "1y");
    url.searchParams.set("drawdownRange", "1y");
    try {
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to fetch market data");
      return payload as MarketData;
    } catch {
      return fallbackMarketData(symbolInput, "1y", "1y");
    }
  }

  async function calculateAllocation() {
    setLoading(true);
    try {
      const seedBySymbol = new Map(portfolioSeed.map((seed) => [normalizeKey(seed.symbol), seed]));
      const nextPositions = await Promise.all(
        allocationRules.map(async (rule) => {
          if (normalizeKey(rule.symbol) === "CASH") {
            const cashCurrency = rule.cashCurrency || "USD";
            const cashValue = await normalizeCashValue(rule.cashValue ?? 0, cashCurrency);

            return {
              category: rule.category,
              symbol: rule.symbol,
              value: cashValue,
              source: "cash" as const
            };
          }

          const seed = seedBySymbol.get(normalizeKey(rule.symbol));
          if (!seed) {
            return {
              category: rule.category,
              symbol: rule.symbol,
              value: 0,
              source: "missing" as const
            };
          }

          if (Number.isFinite(seed.marketValue)) {
            return {
              category: rule.category,
              symbol: rule.symbol,
              value: seed.marketValue!,
              source: "portfolio" as const
            };
          }

          if (Number.isFinite(seed.quantity)) {
            const market = await fetchMarket(seed.symbol);
            return {
              category: rule.category,
              symbol: rule.symbol,
              value: seed.quantity! * market.price,
              source: "portfolio" as const
            };
          }

          return {
            category: rule.category,
            symbol: rule.symbol,
            value: 0,
            source: "missing" as const
          };
        })
      );

      /*
       * Every position above comes from an allocation rule, so a holding with
       * no rule used to contribute nothing here -- it counted towards net
       * worth on /portfolio while the allocation total silently ignored it,
       * and the two pages disagreed. Adding a holding through the editor sets
       * a category, but the holding-value form does not, and neither does a
       * CSV import. Give those an explicit lane so the total is complete and
       * the gap is visible rather than hidden.
       */
      const ruled = new Set(allocationRules.map((rule) => normalizeKey(rule.symbol)));
      const unruled = portfolioSeed.filter((seed) => !ruled.has(normalizeKey(seed.symbol)));

      const unassigned = await Promise.all(
        unruled.map(async (seed) => {
          const value = Number.isFinite(seed.marketValue)
            ? seed.marketValue!
            : Number.isFinite(seed.quantity)
              ? seed.quantity! * (await fetchMarket(seed.symbol)).price
              : 0;

          return {
            category: UNASSIGNED_CATEGORY,
            symbol: seed.symbol,
            value,
            source: "unassigned" as const
          };
        })
      );

      setPositions([...nextPositions, ...unassigned]);
    } finally {
      setLoading(false);
    }
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

  function formatMoney(value: number) {
    if (displayCurrency === "THB" && usdThbRate) {
      return currencyFormat(value * usdThbRate.rate, "THB");
    }

    return currencyFormat(value);
  }

  async function normalizeCashValue(value: number, currency: string) {
    if (currency === "USD") return value;

    if (currency === "THB") {
      const fxMarket = await fetchMarket("THB=X");
      return fxMarket.price > 0 ? value / fxMarket.price : value;
    }

    return value;
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
        <article className="glass-panel overflow-hidden rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">My Allocation</p>
          <h1 className="max-w-4xl font-serif text-5xl leading-none md:text-7xl">Portfolio map by conviction lane.</h1>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <Summary title="Total Mapped" value={formatMoney(totalValue)} />
            <Summary title="Largest Lane" value={largestGroup?.category || "None"} />
            <Summary title="Largest Weight" value={largestGroup ? weightFormat(largestGroup.value, totalValue) : "0.00%"} tone="text-cyan-signal" />
          </div>
        </article>

        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Allocation Lanes</p>
          <h2 className="mb-4 text-2xl font-black">Controls</h2>
          <div className="grid gap-3">
            <button type="button" onClick={calculateAllocation} className="min-h-12 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-slate-300 hover:text-white">
              {loading ? "Refreshing..." : "Refresh allocation"}
            </button>
            <button type="button" onClick={toggleThbDisplay} className="min-h-12 rounded-2xl border border-amber-signal/30 bg-amber-signal/10 px-4 py-3 font-bold text-amber-signal hover:text-white">
              {fxLoading ? "Loading BOT rate..." : displayCurrency === "THB" ? "Show USD" : "Convert USD to THB"}
            </button>
          </div>
          {usdThbRate && (
            <p className="mt-3 text-sm text-slate-400">
              USD/THB {usdThbRate.rate.toFixed(4)} from {usdThbRate.source}, {usdThbRate.period}.
            </p>
          )}
          {fxError && <p className="mt-3 text-sm text-rose-signal">{fxError}</p>}
          {missingPositions.length > 0 && (
            <p className="mt-3 text-sm text-amber-signal">
              In an allocation lane but not held: {missingPositions.map((position) => position.symbol).join(", ")}
            </p>
          )}
          {unassignedPositions.length > 0 && (
            <p className="mt-3 text-sm text-amber-signal">
              Held with no lane: {unassignedPositions.map((position) => position.symbol).join(", ")}. They
              count towards the total under {UNASSIGNED_CATEGORY}; use Edit below to file them.
            </p>
          )}
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(360px,520px)_1fr]">
        <section className="glass-panel rounded-3xl p-6">
          <div className="mx-auto grid max-w-[460px] place-items-center">
            <div
              className="relative grid aspect-square w-full max-w-[360px] place-items-center rounded-full"
              style={{ background: buildConicGradient(groups, totalValue) }}
              aria-label="Portfolio allocation donut chart"
            >
              <div className="grid aspect-square w-[58%] place-items-center rounded-full border border-white/10 bg-panel text-center shadow-[0_0_60px_rgba(0,0,0,.42)]">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">Total</span>
                <strong className="block px-4 text-2xl font-black">{formatMoney(totalValue)}</strong>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-2">
            {groups.map((group) => (
              <div key={group.category} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: group.color }} />
                  <strong className="truncate">{group.category}</strong>
                </span>
                <span className="whitespace-nowrap text-sm font-black text-slate-300">{weightFormat(group.value, totalValue)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="border-b border-white/10 p-6">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Allocation Detail</p>
            <h2 className="text-2xl font-black">Category table</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Symbols</th>
                  <th className="px-6 py-4">Value</th>
                  <th className="px-6 py-4">Weight</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.category} className="border-t border-white/10">
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ background: group.color }} />
                        <strong>{group.category}</strong>
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-300">{group.symbols.join(", ")}</td>
                    <td className="px-6 py-4 font-black">{formatMoney(group.value)}</td>
                    <td className="px-6 py-4 font-black text-cyan-signal">{weightFormat(group.value, totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-white/10 p-6">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Positions</p>
            <h2 className="text-2xl font-black">Edit a symbol&apos;s lane</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-4">Symbol</th>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Value</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={`${position.category}-${position.symbol}`} className="border-t border-white/10">
                    <td className="px-6 py-4">
                      <strong>{position.symbol}</strong>
                      {position.source === "missing" && (
                        <small className="block text-amber-signal">not in portfolio</small>
                      )}
                      {position.source === "cash" && <small className="block text-slate-500">cash balance</small>}
                      {position.source === "unassigned" && (
                        <small className="block text-amber-signal">no lane assigned</small>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{position.category}</td>
                    <td className="px-6 py-4 font-black">{formatMoney(position.value)}</td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => openEditor(position)}
                        className="rounded-full border border-cyan-signal/30 bg-cyan-signal/10 px-3 py-1 text-sm font-bold text-cyan-signal transition hover:text-white"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-slate-400">
                      No allocation rows yet.
                    </td>
                  </tr>
                )}
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

function normalizeKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

function weightFormat(value: number, totalValue: number) {
  if (!totalValue || !Number.isFinite(value)) return "0.00%";
  return `${((value / totalValue) * 100).toFixed(2)}%`;
}

function buildConicGradient(groups: AllocationGroup[], totalValue: number) {
  if (!totalValue) return "conic-gradient(rgba(255,255,255,.08) 0deg 360deg)";

  let cursor = 0;
  const stops = groups
    .filter((group) => group.value > 0)
    .map((group) => {
      const start = cursor;
      const end = cursor + (group.value / totalValue) * 360;
      cursor = end;
      return `${group.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    });

  return `conic-gradient(${stops.join(", ")})`;
}
