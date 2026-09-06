"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { currencyFormat } from "@/lib/format";
import type { AllocationRule, PortfolioSeed } from "@/types/portfolio";

/** The allocation row that carries a literal balance instead of a position. */
export const CASH_SYMBOL = "CASH";

export type HoldingEditorSave = {
  portfolio?: PortfolioSeed[];
  allocationRules?: AllocationRule[];
};

export type HoldingEditorTarget = {
  symbol: string;
  quantity?: number;
  /** Per-unit price. The modal turns it into a cost basis on save. */
  buyPrice?: number;
  costCurrency?: string;
  category?: string;
  cashValue?: number;
  cashCurrency?: string;
};

type Props = {
  /** null adds a new holding; a target edits that one. */
  target: HoldingEditorTarget | null;
  categories: string[];
  onClose: () => void;
  onSaved: (result: HoldingEditorSave) => void;
};

const currencies = ["USD", "THB", "EUR", "GBP", "JPY"];

/**
 * Single editor for a position and the allocation lane it sits in, shared by
 * the portfolio and allocation pages so both write through the same path.
 *
 * Quantity and buy price are stored as a total cost basis, which is what the
 * holdings table holds; entering them directly avoids the round trip through a
 * market quote that the holding-value form needs.
 */
export function HoldingEditorModal({ target, categories, onClose, onSaved }: Props) {
  const isEdit = Boolean(target);
  const isCash = (target?.symbol ?? "").toUpperCase() === CASH_SYMBOL;

  const [symbol, setSymbol] = useState(target?.symbol ?? "");
  const [quantity, setQuantity] = useState(target?.quantity ? String(target.quantity) : "");
  const [buyPrice, setBuyPrice] = useState(target?.buyPrice ? String(target.buyPrice) : "");
  const [costCurrency, setCostCurrency] = useState(target?.costCurrency || "USD");
  const [category, setCategory] = useState(target?.category ?? "");
  const [cashValue, setCashValue] = useState(target?.cashValue ? String(target.cashValue) : "");
  const [cashCurrency, setCashCurrency] = useState(target?.cashCurrency || "THB");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [onClose, saving]);

  const costBasis = useMemo(() => {
    const q = Number(quantity);
    const p = Number(buyPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return null;
    return q * p;
  }, [quantity, buyPrice]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return setError("Symbol is required.");
    if (!category.trim()) return setError("Allocation category is required.");

    setSaving(true);

    try {
      if (isCash) {
        const value = Number(cashValue);
        if (!Number.isFinite(value) || value < 0) throw new Error("Cash value must be zero or more.");

        const response = await fetch("/api/allocation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol: cleanSymbol,
            category: category.trim(),
            cashValue: value,
            cashCurrency
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to save the allocation");

        onSaved({ allocationRules: payload.allocationRules });
      } else {
        const q = Number(quantity);
        const p = Number(buyPrice);
        if (!Number.isFinite(q) || q <= 0) throw new Error("Quantity must be greater than zero.");
        if (!Number.isFinite(p) || p <= 0) throw new Error("Buy price must be greater than zero.");

        const response = await fetch("/api/portfolio/my-port", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            stock: cleanSymbol,
            quantity: q,
            buyPrice: p,
            costCurrency,
            category: category.trim()
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to save the holding");

        onSaved({ portfolio: payload.portfolio, allocationRules: payload.allocationRules });
      }

      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#03070c]/88 px-3 py-4 backdrop-blur-xl md:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="holding-editor-title"
      onClick={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <div className="glass-panel max-h-full w-full max-w-lg overflow-auto rounded-3xl p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
              {isEdit ? "Edit position" : "New position"}
            </p>
            <h2 id="holding-editor-title" className="text-2xl font-black">
              {isEdit ? target!.symbol : "Add to portfolio"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 text-xl text-slate-400 transition hover:text-white disabled:opacity-50"
          >
            {"×"}
          </button>
        </div>

        <form onSubmit={submit} className="grid gap-3">
          <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Symbol</span>
            <input
              id="editor-symbol"
              name="symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              readOnly={isEdit}
              placeholder="AAPL"
              autoFocus={!isEdit}
              className="bg-transparent text-lg outline-none read-only:text-slate-400"
            />
          </label>

          {isCash ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Cash value</span>
                <input
                  id="editor-cash-value"
                  name="cashValue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashValue}
                  onChange={(event) => setCashValue(event.target.value)}
                  className="bg-transparent text-lg outline-none"
                />
              </label>
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Currency</span>
                <select
                  id="editor-cash-currency"
                  name="cashCurrency"
                  value={cashCurrency}
                  onChange={(event) => setCashCurrency(event.target.value)}
                  className="bg-transparent text-lg outline-none"
                >
                  {currencies.map((item) => (
                    <option className="bg-panel" key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Quantity</span>
                  <input
                    id="editor-quantity"
                    name="quantity"
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="1.70691618"
                    autoFocus={isEdit}
                    className="bg-transparent text-lg outline-none"
                  />
                </label>
                <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Buy price</span>
                  <input
                    id="editor-buy-price"
                    name="buyPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={buyPrice}
                    onChange={(event) => setBuyPrice(event.target.value)}
                    placeholder="187.70"
                    className="bg-transparent text-lg outline-none"
                  />
                </label>
              </div>

              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Cost currency</span>
                <select
                  id="editor-cost-currency"
                  name="costCurrency"
                  value={costCurrency}
                  onChange={(event) => setCostCurrency(event.target.value)}
                  className="bg-transparent text-lg outline-none"
                >
                  {currencies.map((item) => (
                    <option className="bg-panel" key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
                Cost basis{" "}
                <strong className="text-white">
                  {costBasis === null ? "—" : currencyFormat(costBasis, costCurrency)}
                </strong>
                <span className="block text-xs text-slate-500">
                  quantity x buy price, stored as the position total
                </span>
              </p>
            </>
          )}

          <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Allocation category
            </span>
            <input
              id="editor-category"
              name="category"
              list="allocation-categories"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Software"
              className="bg-transparent text-lg outline-none"
            />
            <datalist id="allocation-categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <span className="text-xs text-slate-500">
              Pick an existing lane or type a new one. A symbol lives in exactly one lane.
            </span>
          </label>

          {error && (
            <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-signal">
              {error}
            </p>
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
              {saving ? "Saving..." : isEdit ? "Save changes" : "Add holding"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
