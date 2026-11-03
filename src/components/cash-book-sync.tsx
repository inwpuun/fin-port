"use client";

import { useActionState } from "react";
import { refreshCashBookAction, type RefreshState } from "@/app/cash-book/actions";

const initialState: RefreshState = {};

export function CashBookSync() {
  const [state, formAction, pending] = useActionState(refreshCashBookAction, initialState);

  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-6">
      <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Source</p>
      <h2 className="mb-1 text-2xl font-black">Firefly III</h2>
      <p className="mb-4 text-sm text-slate-400">
        Read live from Firefly and refreshed every couple of minutes. Add, edit or delete transactions in
        Firefly; refresh to see a change here straight away.
      </p>

      <form action={formAction}>
        <button
          disabled={pending}
          className="min-h-12 w-full rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e] disabled:opacity-60"
        >
          {pending ? "Refreshing..." : "Refresh"}
        </button>
      </form>

      {state.error ? (
        <p className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-signal">
          {state.error}
        </p>
      ) : null}

      {state.summary ? (
        <p className="mt-3 rounded-2xl border border-mint-signal/30 bg-mint-signal/10 px-4 py-3 text-sm text-mint-signal">
          {state.summary}
        </p>
      ) : null}
    </section>
  );
}
