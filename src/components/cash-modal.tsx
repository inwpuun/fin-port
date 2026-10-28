"use client";

import { FormEvent, useState } from "react";
import { currencyFormat } from "@/lib/format";
import type { AllocationRule, CashBalances, HoldingTransaction } from "@/types/portfolio";
import { ModalShell, localToday } from "./modal-shell";
import { Field } from "./transaction-modal";

export type CashSave = {
  transactions: HoldingTransaction[];
  allocationRules: AllocationRule[];
  cash: CashBalances;
};

type Props = {
  cash: CashBalances;
  category: string;
  categories: string[];
  onClose: () => void;
  onSaved: (result: CashSave) => void;
};

/**
 * Both cash balances at once, as they stand at the broker or bank. Saving
 * records only the difference, as a deposit or withdrawal on the chosen date,
 * so the net-worth history can tell new money from growth.
 */
export function CashModal({ cash, category: initialCategory, categories, onClose, onSaved }: Props) {
  const [usd, setUsd] = useState(String(cash.USD));
  const [thb, setThb] = useState(String(cash.THB));
  const [occurredOn, setOccurredOn] = useState(localToday());
  const [category, setCategory] = useState(initialCategory || "Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const response = await fetch("/api/portfolio/cash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usd: Number(usd || 0), thb: Number(thb || 0), occurredOn, category: category.trim() })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update cash");

      onSaved(payload as CashSave);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update cash.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell eyebrow="Cash" title="Update cash balances" titleId="cash-title" busy={saving} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="US dollars">
            <input
              id="cash-usd"
              name="usd"
              type="number"
              min="0"
              step="any"
              value={usd}
              onChange={(event) => setUsd(event.target.value)}
              autoFocus
              className="bg-transparent text-lg outline-none"
            />
          </Field>
          <Field label="Thai baht">
            <input
              id="cash-thb"
              name="thb"
              type="number"
              min="0"
              step="any"
              value={thb}
              onChange={(event) => setThb(event.target.value)}
              className="bg-transparent text-lg outline-none"
            />
          </Field>
        </div>

        <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
          Now <strong className="text-white">{currencyFormat(cash.USD, "USD")}</strong> and{" "}
          <strong className="text-white">{currencyFormat(cash.THB, "THB")}</strong>
          <span className="block text-xs text-slate-500">
            The difference is saved as a deposit or withdrawal on the date below.
          </span>
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="As of">
            <input
              id="cash-date"
              name="occurredOn"
              type="date"
              required
              max={localToday()}
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              className="bg-transparent text-lg outline-none [color-scheme:dark]"
            />
          </Field>
          <Field label="Allocation lane">
            <input
              id="cash-category"
              name="category"
              list="cash-categories"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="bg-transparent text-lg outline-none"
            />
            <datalist id="cash-categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
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
            {saving ? "Saving..." : "Save balances"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
