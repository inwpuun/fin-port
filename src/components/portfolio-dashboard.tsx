"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { currencyFormat, percentFormat } from "@/lib/format";
import { removeHoldingAction, saveHoldingAction, type ActionState } from "@/app/portfolio/actions";
import type { DrawdownRange } from "@/types/market";
import type { PortfolioView } from "@/lib/data/portfolio-view";

type Props = {
  view: PortfolioView;
  drawdownRange: DrawdownRange;
  drawdownRanges: Array<{ value: DrawdownRange; label: string }>;
  drawdownLimit: string;
};

const initialState: ActionState = {};

export function PortfolioDashboard({ view, drawdownRange, drawdownRanges, drawdownLimit }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveHoldingAction, initialState);
  const [limit, setLimit] = useState(drawdownLimit);

  const { rows, totals, buckets, baseCurrency, unavailable, fxIncomplete } = view;

  const threshold = Number(limit || 0);
  const breaches = useMemo(
    () => rows.filter((row) => Math.abs(row.drawdownPercent) >= threshold),
    [rows, threshold]
  );
  const rangeLabel = drawdownRanges.find((item) => item.value === drawdownRange)?.label ?? "1 year";

  function applyRange(next: string) {
    const params = new URLSearchParams({ drawdownRange: next, limit });
    router.push(`/portfolio?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <article className="glass-panel overflow-hidden rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">My Portfolio</p>
          <h1 className="max-w-4xl font-serif text-5xl leading-none md:text-7xl">
            Net worth radar for every position.
          </h1>
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            <Summary title={`Net Worth (${baseCurrency})`} value={currencyFormat(totals.netWorth, baseCurrency)} />
            <Summary title="Positions" value={currencyFormat(totals.marketValue, baseCurrency)} />
            <Summary title="Cash" value={currencyFormat(totals.cashValue, baseCurrency)} />
            <Summary
              title="Total P/L"
              value={`${currencyFormat(totals.profitLoss, baseCurrency)} ${percentFormat(totals.profitLossPercent)}`}
              tone={totals.profitLoss >= 0 ? "text-mint-signal" : "text-rose-signal"}
            />
          </div>

          {unavailable.length ? (
            <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-signal">
              No quote for {unavailable.map((item) => item.symbol).join(", ")}. These are excluded from
              every total rather than filled with demo prices.
            </p>
          ) : null}
          {fxIncomplete ? (
            <p className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-signal">
              An FX rate was unavailable, so a non-{baseCurrency} amount is counted at 1:1. Refresh to retry.
            </p>
          ) : null}
        </article>

        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Drawdown Detector</p>
          <h2 className="mb-4 text-2xl font-black">Previous top % alert</h2>

          <label className="field-shell mb-4 grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Flag positions down by %</span>
            <input
              id="portfolio-drawdown-limit"
              name="portfolioDrawdownLimit"
              className="bg-transparent text-xl outline-none"
              type="number"
              min="0"
              step="0.1"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>

          <label className="field-shell mb-4 grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Previous top window</span>
            <select
              id="portfolio-drawdown-range"
              name="portfolioDrawdownRange"
              className="bg-transparent text-xl outline-none"
              value={drawdownRange}
              onChange={(event) => applyRange(event.target.value)}
            >
              {drawdownRanges.map((item) => (
                <option className="bg-panel" key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <strong className={breaches.length ? "text-amber-signal" : "text-mint-signal"}>
              {breaches.length
                ? `${breaches.length} position${breaches.length > 1 ? "s" : ""} flagged`
                : "No drawdown breach"}
            </strong>
            <p className="mt-1 text-sm text-slate-400">
              Measured from the highest candle in the selected {rangeLabel} window.
            </p>
          </div>
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-[390px_1fr]">
        <div className="grid gap-4">
          <section className="glass-panel rounded-3xl p-6">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Holding Input</p>
            <h2 className="mb-1 text-2xl font-black">Add or update a position</h2>
            <p className="mb-4 text-sm text-slate-400">
              Saving an existing symbol overwrites it. Cost basis is the total paid, not a unit price.
            </p>

            <form action={formAction} className="grid gap-3">
              <Field label="Symbol" id="symbol" name="symbol" placeholder="AAPL" />
              <Field label="Quantity" id="quantity" name="quantity" type="number" step="any" min="0" placeholder="1.705" />
              <Field label="Cost basis (total)" id="costBasis" name="costBasis" type="number" step="0.01" min="0" placeholder="320.38" />
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Cost currency</span>
                <select
                  id="costCurrency"
                  name="costCurrency"
                  defaultValue="USD"
                  className="bg-transparent text-lg outline-none"
                >
                  <option className="bg-panel" value="USD">USD</option>
                  <option className="bg-panel" value="THB">THB</option>
                  <option className="bg-panel" value="EUR">EUR</option>
                </select>
              </label>

              <button
                disabled={pending}
                className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e] disabled:opacity-60"
              >
                {pending ? "Saving..." : "Save holding"}
              </button>
            </form>

            {state.error ? (
              <p className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-signal">
                {state.error}
              </p>
            ) : null}
            {state.message ? (
              <p className="mt-3 rounded-2xl border border-mint-signal/30 bg-mint-signal/10 px-4 py-3 text-sm text-mint-signal">
                {state.message}
              </p>
            ) : null}

            <button
              onClick={() => router.refresh()}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-slate-300 hover:text-white"
            >
              Refresh prices
            </button>
          </section>

          <section className="glass-panel rounded-3xl p-6">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Allocation</p>
            <h2 className="mb-4 text-2xl font-black">Weight by category</h2>
            <div className="grid gap-3">
              {buckets.map((bucket) => (
                <div key={bucket.category}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <strong className="text-sm">{bucket.category}</strong>
                    <span className="text-sm text-slate-400">
                      {bucket.weightPercent.toFixed(1)}% · {currencyFormat(bucket.marketValue, baseCurrency)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-signal to-mint-signal"
                      style={{ width: `${Math.min(100, bucket.weightPercent)}%` }}
                    />
                  </div>
                  <small className="text-slate-500">{bucket.symbols.join(", ")}</small>
                </div>
              ))}
              {buckets.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No allocation rows yet. Run <code className="text-cyan-signal">npm run db:seed</code>.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="border-b border-white/10 p-6">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Positions</p>
            <h2 className="text-2xl font-black">Holdings table</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-4">Symbol</th>
                  <th className="px-6 py-4">Qty</th>
                  <th className="px-6 py-4">Avg cost</th>
                  <th className="px-6 py-4">Now</th>
                  <th className="px-6 py-4">Value</th>
                  <th className="px-6 py-4">P/L</th>
                  <th className="px-6 py-4">From Top</th>
                  <th className="px-6 py-4" />
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
                    <td className="px-6 py-4">
                      {currencyFormat(row.buyPrice, row.costCurrency)}
                      {row.costCurrency !== row.currency ? (
                        <small className="ml-1 text-slate-500">{row.costCurrency}</small>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">{currencyFormat(row.currentPrice, row.currency)}</td>
                    <td className="px-6 py-4 font-black">{currencyFormat(row.marketValue, row.currency)}</td>
                    <td className={`px-6 py-4 font-black ${row.profitLoss >= 0 ? "text-mint-signal" : "text-rose-signal"}`}>
                      {currencyFormat(row.profitLoss, row.currency)} {percentFormat(row.profitLossPercent)}
                    </td>
                    <td
                      className={`px-6 py-4 font-black ${
                        Math.abs(row.drawdownPercent) >= threshold ? "text-amber-signal" : "text-slate-300"
                      }`}
                    >
                      {percentFormat(row.drawdownPercent)}
                    </td>
                    <td className="px-6 py-4">
                      <form action={removeHoldingAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-400 hover:text-white">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                      No positions in Postgres yet. Run <code className="text-cyan-signal">npm run db:seed</code> to
                      load <code>data/my-port.csv</code>.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function Field({
  label,
  id,
  name,
  ...rest
}: { label: string; id: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <input id={id} name={name} className="bg-transparent text-lg outline-none" {...rest} />
    </label>
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
