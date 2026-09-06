"use client";

import { useActionState } from "react";
import { importCashBookAction, type ImportState } from "@/app/cash-book/actions";

const initialState: ImportState = {};

export function CashBookImport() {
  const [state, formAction, pending] = useActionState(importCashBookAction, initialState);

  return (
    <section className="glass-panel rounded-3xl p-6">
      <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Import</p>
      <h2 className="mb-1 text-2xl font-black">CSV to Postgres</h2>
      <p className="mb-4 text-sm text-slate-400">
        Upsert mode. Row ids are content hashes of account, description, date, time and amount, so
        re-importing the same export changes nothing and a corrected export updates rows in place.
      </p>

      <form action={formAction} className="grid gap-3">
        <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
            report-*.csv exports
          </span>
          <input
            id="cash-book-files"
            name="files"
            type="file"
            accept=".csv,text/csv"
            multiple
            className="bg-transparent text-sm outline-none file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:font-bold file:text-white"
          />
        </label>

        <button
          disabled={pending}
          className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e] disabled:opacity-60"
        >
          {pending ? "Importing..." : "Import CSV"}
        </button>
      </form>

      {state.error ? (
        <p className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-signal">
          {state.error}
        </p>
      ) : null}

      {state.summary ? (
        <div className="mt-3 rounded-2xl border border-mint-signal/30 bg-mint-signal/10 px-4 py-3 text-sm text-mint-signal">
          <strong className="block">{state.summary}</strong>
          {state.details?.map((line) => (
            <small key={line} className="mt-1 block text-slate-300">
              {line}
            </small>
          ))}
        </div>
      ) : null}
    </section>
  );
}
