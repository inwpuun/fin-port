"use client";

import { FormEvent, useMemo, useState } from "react";
import { currencyFormat } from "@/lib/format";
import { normalizeSymbol } from "@/lib/market";
import type { AllocationRule, CashBalances, HoldingTransaction, PortfolioSeed } from "@/types/portfolio";
import { ModalShell, localToday } from "./modal-shell";

export type TransactionSave = {
  transactions: HoldingTransaction[];
  portfolio?: PortfolioSeed[];
  allocationRules?: AllocationRule[];
  cash: CashBalances;
};

export type TransactionKind = "buy" | "sell" | "deposit" | "withdraw";

const kinds: Array<{ value: TransactionKind; label: string }> = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "deposit", label: "Deposit" },
  { value: "withdraw", label: "Withdraw" }
];

const tradeCurrencies = ["USD", "THB"];

type Props = {
  initialKind?: TransactionKind;
  initialSymbol?: string;
  portfolio: PortfolioSeed[];
  categories: string[];
  cash: CashBalances;
  onClose: () => void;
  onSaved: (result: TransactionSave) => void;
};

/**
 * Records one buy, sell, deposit or withdrawal. A buy or sell changes the
 * position by that trade -- quantity and average cost are rebuilt from the
 * whole log on the server -- instead of overwriting the holding outright.
 */
export function TransactionModal({ initialKind = "buy", initialSymbol = "", portfolio, categories, cash, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<TransactionKind>(initialKind);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [currency, setCurrency] = useState(() => holdingFor(portfolio, initialSymbol)?.costCurrency || "USD");
  const [occurredOn, setOccurredOn] = useState(localToday());
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCash = kind === "deposit" || kind === "withdraw";
  const held = holdingFor(portfolio, symbol);
  const needsCategory = kind === "buy" && symbol.trim() !== "" && !held;

  const total = useMemo(() => {
    const q = Number(quantity);
    const p = isCash ? 1 : Number(price);
    const f = Number(fee || 0);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return null;
    return q * p + (kind === "buy" ? f : kind === "sell" ? -f : 0);
  }, [quantity, price, fee, kind, isCash]);

  function chooseSymbol(value: string) {
    setSymbol(value);
    const match = holdingFor(portfolio, value);
    if (match?.costCurrency) setCurrency(match.costCurrency);
  }

  function chooseKind(next: TransactionKind) {
    setKind(next);
    setError("");
    const nextIsCash = next === "deposit" || next === "withdraw";
    if (nextIsCash && !tradeCurrencies.includes(currency)) setCurrency("THB");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!isCash && !symbol.trim()) return setError("Symbol is required.");
    if (needsCategory && !category.trim()) return setError("Pick an allocation lane for a new symbol.");

    setSaving(true);
    try {
      const response = await fetch("/api/portfolio/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side: kind,
          symbol: isCash ? undefined : symbol.trim().toUpperCase(),
          quantity: Number(quantity),
          price: isCash ? 1 : Number(price),
          fee: isCash ? 0 : Number(fee || 0),
          currency,
          occurredOn,
          note,
          category: needsCategory ? category.trim() : undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save the transaction");

      onSaved(payload as TransactionSave);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the transaction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow="New transaction" title="Record a trade or cash move" titleId="transaction-title" busy={saving} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Transaction type">
          {kinds.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={kind === item.value}
              onClick={() => chooseKind(item.value)}
              className={`min-h-10 rounded-xl text-sm font-black transition ${
                kind === item.value ? "bg-white text-[#05110e]" : "text-slate-400 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isCash ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <Field label={kind === "deposit" ? "Amount in" : "Amount out"}>
                <input
                  id="transaction-amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="bg-transparent text-lg outline-none"
                />
              </Field>
              <Field label="Currency">
                <select
                  id="transaction-cash-currency"
                  name="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="bg-transparent text-lg outline-none"
                >
                  {tradeCurrencies.map((item) => (
                    <option className="bg-panel" key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
              Cash now{" "}
              <strong className="text-white">{currencyFormat(cash.USD, "USD")}</strong> and{" "}
              <strong className="text-white">{currencyFormat(cash.THB, "THB")}</strong>
            </p>
          </>
        ) : (
          <>
            <Field label="Symbol">
              <input
                id="transaction-symbol"
                name="symbol"
                list="transaction-symbols"
                required
                value={symbol}
                onChange={(event) => chooseSymbol(event.target.value)}
                placeholder="VOO"
                autoFocus={!initialSymbol}
                autoCapitalize="characters"
                className="bg-transparent text-lg uppercase outline-none placeholder:normal-case"
              />
              <datalist id="transaction-symbols">
                {portfolio.map((item) => (
                  <option key={item.symbol} value={item.symbol} />
                ))}
              </datalist>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Quantity"
                action={
                  kind === "sell" && held?.quantity ? (
                    <button type="button" onClick={() => setQuantity(String(held.quantity))} className="text-xs font-bold text-cyan-signal">
                      All {held.quantity}
                    </button>
                  ) : null
                }
              >
                <input
                  id="transaction-quantity"
                  name="quantity"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="0.00"
                  autoFocus={Boolean(initialSymbol)}
                  className="bg-transparent text-lg outline-none"
                />
              </Field>
              <Field label="Price per unit">
                <input
                  id="transaction-price"
                  name="price"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="0.00"
                  className="bg-transparent text-lg outline-none"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Currency">
                <select
                  id="transaction-currency"
                  name="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  disabled={Boolean(held)}
                  className="bg-transparent text-lg outline-none disabled:text-slate-400"
                >
                  {tradeCurrencies.map((item) => (
                    <option className="bg-panel" key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fee (optional)">
                <input
                  id="transaction-fee"
                  name="fee"
                  type="number"
                  min="0"
                  step="any"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  placeholder="0.00"
                  className="bg-transparent text-lg outline-none"
                />
              </Field>
            </div>

            {needsCategory && (
              <Field label="Allocation lane">
                <input
                  id="transaction-category"
                  name="category"
                  list="transaction-categories"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="Software"
                  className="bg-transparent text-lg outline-none"
                />
                <datalist id="transaction-categories">
                  {categories.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </Field>
            )}

            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
              {kind === "buy" ? "Cost" : "Proceeds"}{" "}
              <strong className="text-white">{total === null ? "—" : currencyFormat(total, currency)}</strong>
              {held && (
                <span className="block text-xs text-slate-500">
                  Holding {held.quantity} {held.symbol} now
                </span>
              )}
            </p>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <input
              id="transaction-date"
              name="occurredOn"
              type="date"
              required
              max={localToday()}
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              className="bg-transparent text-lg outline-none [color-scheme:dark]"
            />
          </Field>
          <Field label="Note (optional)">
            <input
              id="transaction-note"
              name="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="bg-transparent text-lg outline-none"
            />
          </Field>
        </div>

        {error && (
          <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-signal">{error}</p>
        )}

        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-12 rounded-2xl border border-white/10 bg-white/5 font-bold text-slate-300 transition hover:text-white disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : `Record ${kinds.find((item) => item.value === kind)!.label.toLowerCase()}`}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function Field({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
      <span className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
        {action}
      </span>
      {children}
    </label>
  );
}

function holdingFor(portfolio: PortfolioSeed[], symbol: string) {
  const key = symbol.trim() ? normalizeSymbol(symbol) : "";
  return key ? portfolio.find((item) => normalizeSymbol(item.symbol) === key) : undefined;
}
