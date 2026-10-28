"use client";

import { useMemo, useState } from "react";
import { currencyFormat } from "@/lib/format";
import { normalizeSymbol } from "@/lib/market";
import type { HoldingTransaction } from "@/types/portfolio";
import type { TransactionSave } from "./transaction-modal";

const PAGE = 25;

const sideTone: Record<string, string> = {
  buy: "text-mint-signal",
  sell: "text-rose-signal",
  deposit: "text-cyan-signal",
  withdraw: "text-amber-signal"
};

/**
 * The trade log, newest first. Deleting a row rebuilds its position from the
 * trades that remain, so a mistyped trade is fixed by deleting it and
 * recording it again.
 */
export function TransactionsTable({
  transactions,
  onChanged
}: {
  transactions: HoldingTransaction[];
  onChanged: (result: TransactionSave) => void;
}) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");

  const symbols = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.symbol.toUpperCase()))].sort(),
    [transactions]
  );

  const filtered = useMemo(
    () =>
      filter
        ? transactions.filter((transaction) => normalizeSymbol(transaction.symbol) === normalizeSymbol(filter))
        : transactions,
    [transactions, filter]
  );
  const visible = filtered.slice(0, limit);

  async function remove(transaction: HoldingTransaction) {
    const label = `${transaction.side} ${transaction.quantity} ${transaction.symbol} on ${transaction.occurredOn}`;
    if (!window.confirm(`Delete ${label}? The position is rebuilt from the remaining trades.`)) return;

    setDeleting(transaction.id);
    setError("");
    try {
      const response = await fetch(`/api/portfolio/transactions?id=${encodeURIComponent(transaction.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to delete the transaction");
      onChanged(payload as TransactionSave);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the transaction");
    } finally {
      setDeleting("");
    }
  }

  return (
    <section className="glass-panel overflow-hidden rounded-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 p-4 sm:p-6">
        <div>
          <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Trade log</p>
          <h2 className="text-2xl font-black">Transactions</h2>
        </div>
        <label className="field-shell flex items-center gap-2 rounded-2xl px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Symbol</span>
          <select
            id="transactions-filter"
            name="transactionsFilter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(PAGE);
            }}
            className="bg-transparent font-bold outline-none"
          >
            <option className="bg-panel" value="">
              All
            </option>
            {symbols.map((symbol) => (
              <option className="bg-panel" key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="border-b border-white/10 px-4 py-3 text-sm text-rose-signal sm:px-6">{error}</p>}

      <ul className="divide-y divide-white/10 md:hidden">
        {visible.map((transaction) => (
          <li key={transaction.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <strong className="block">
                <span className={`uppercase ${sideTone[transaction.side] ?? "text-slate-300"}`}>{transaction.side}</span>{" "}
                {transaction.symbol}
              </strong>
              <small className="block text-slate-400">
                {transaction.occurredOn} · {describe(transaction)}
              </small>
              {transaction.note && <small className="block truncate text-slate-500">{transaction.note}</small>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <strong className="font-black tabular-nums">{totalFormat(total(transaction), transaction.currency)}</strong>
              <DeleteButton busy={deleting === transaction.id} onClick={() => remove(transaction)} />
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Symbol</th>
              <th className="px-6 py-4 text-right">Qty / amount</th>
              <th className="px-6 py-4 text-right">Price</th>
              <th className="px-6 py-4 text-right">Total</th>
              <th className="px-6 py-4">Note</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((transaction) => (
              <tr key={transaction.id} className="border-t border-white/10">
                <td className="px-6 py-3 tabular-nums text-slate-300">{transaction.occurredOn}</td>
                <td className={`px-6 py-3 font-black uppercase ${sideTone[transaction.side] ?? "text-slate-300"}`}>{transaction.side}</td>
                <td className="px-6 py-3 font-black">{transaction.symbol}</td>
                <td className="px-6 py-3 text-right tabular-nums">{quantityFormat(transaction.quantity)}</td>
                <td className="px-6 py-3 text-right tabular-nums text-slate-300">
                  {isCash(transaction) ? "—" : currencyFormat(transaction.price, transaction.currency)}
                </td>
                <td className="px-6 py-3 text-right font-black tabular-nums">{totalFormat(total(transaction), transaction.currency)}</td>
                <td className="max-w-[200px] truncate px-6 py-3 text-sm text-slate-500">{transaction.note}</td>
                <td className="px-6 py-3 text-right">
                  <DeleteButton busy={deleting === transaction.id} onClick={() => remove(transaction)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!filtered.length && <p className="p-8 text-center text-slate-400">No transactions yet.</p>}
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((current) => current + PAGE * 4)}
          className="w-full border-t border-white/10 px-4 py-3 font-bold text-slate-300 hover:text-white"
        >
          Show more ({filtered.length - limit} older)
        </button>
      )}
    </section>
  );
}

function DeleteButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="min-h-9 rounded-full border border-white/10 px-3 text-sm text-slate-400 hover:text-white disabled:opacity-60"
    >
      {busy ? "Deleting..." : "Delete"}
    </button>
  );
}

function isCash(transaction: HoldingTransaction) {
  return transaction.side === "deposit" || transaction.side === "withdraw";
}

function total(transaction: HoldingTransaction) {
  if (isCash(transaction)) return transaction.quantity;
  const gross = transaction.quantity * transaction.price;
  return transaction.side === "sell" ? gross - transaction.fee : gross + transaction.fee;
}

function describe(transaction: HoldingTransaction) {
  if (isCash(transaction)) return transaction.currency;
  return `${quantityFormat(transaction.quantity)} @ ${currencyFormat(transaction.price, transaction.currency)}`;
}

/** Totals are money that changed hands, so cents; prices keep currencyFormat's extra places. */
function totalFormat(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function quantityFormat(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 }).format(value);
}
