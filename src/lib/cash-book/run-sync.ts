import "server-only";
import { withTransaction } from "@/lib/db/client";
import { reloadCashBook } from "./firefly-book";
import { describeCashSync, syncCashFromBook, todayInBangkok } from "./sync-cash";

export type CashBookRefresh = { rows: number; changed: boolean; cash: string | null };

declare global {
  /** Book fingerprint and Bangkok day of the last successful THB cash rebuild. */
  var __finPortCashRebuilt: { fingerprint: string; day: string } | undefined;
}

/**
 * Reads Firefly now and keeps THB cash in step with it. Run by the timer, the
 * Refresh button and POST /api/cash-book/refresh.
 *
 * THB cash (weekly steps in the trade log, which the net-worth chart reads) is
 * rebuilt when the book differs from the one it was last built from, once a
 * day -- a future-dated row reaches today's cash on its day without anything
 * in Firefly changing -- and after a failed attempt.
 */
export async function refreshCashBook(): Promise<CashBookRefresh> {
  const { book, fingerprint, changed } = await reloadCashBook();
  const today = todayInBangkok();
  const last = globalThis.__finPortCashRebuilt;

  let cash: string | null = null;
  if (!last || last.fingerprint !== fingerprint || last.day !== today) {
    try {
      cash = describeCashSync(await withTransaction((client) => syncCashFromBook(client, book)));
      globalThis.__finPortCashRebuilt = { fingerprint, day: today };
    } catch (error) {
      globalThis.__finPortCashRebuilt = undefined;
      cash = `Cash not updated: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return { rows: book.rows.length, changed, cash };
}

export function describeCashBookRefresh(result: CashBookRefresh) {
  const head = `Firefly: ${result.rows} rows${result.changed ? ", changed since the last read" : ", no changes"}.`;
  return [head, result.cash].filter(Boolean).join(" ");
}
