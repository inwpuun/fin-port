import "server-only";
import { query } from "@/lib/db/client";
import { normalizeSymbol } from "@/lib/market";

/**
 * Watchlist storage. Exported surface is unchanged from the CSV version; only
 * the backing store moved to Postgres, which also removes the need for a
 * writable filesystem (the CSV version rewrote public/my-watchlist.csv on
 * every edit).
 */

const fallbackWatchlistSymbols = ["AAPL", "MSFT", "NVDA", "VOO", "BTC-USD", "GC=F"];

export async function getMyWatchlistSymbols(): Promise<string[]> {
  let rows: Array<{ symbol: string }>;

  try {
    rows = await query<{ symbol: string }>(
      `select symbol from watchlist order by sort_order, symbol`
    );
  } catch (error) {
    // Deliberately NOT falling back to the starter symbols here. Substituting
    // a plausible list on a connection failure made a broken deployment look
    // healthy: the watchlist rendered six sensible tickers while holdings and
    // allocations came back empty, which reads as "the holdings table is
    // broken" instead of "the database is unreachable".
    console.error("getMyWatchlistSymbols failed:", error);
    return [];
  }

  // Only a genuinely empty table gets the starter list.
  const symbols = uniqueSymbols(rows.map((row) => row.symbol));
  return symbols.length ? symbols : fallbackWatchlistSymbols;
}

export async function upsertMyWatchlistSymbol(symbol: string): Promise<string[]> {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");

  try {
    // The CSV version prepended the new symbol. Reproduce that ordering by
    // giving it a sort_order below every existing row -- computed inside the
    // statement, so a concurrent insert cannot slot in between the read and
    // the write.
    await query(
      `insert into watchlist (symbol, sort_order)
            values ($1, coalesce((select min(sort_order) from watchlist), 0) - 1)
       on conflict (symbol)
       do update set sort_order = excluded.sort_order`,
      [normalized]
    );
  } catch (error) {
    throw new Error(
      `Could not save ${normalized}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return getMyWatchlistSymbols();
}

export async function deleteMyWatchlistSymbol(symbol: string): Promise<string[]> {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");

  // Stored symbols may predate normalization ("BRK.B" vs "BRK-B"), so resolve
  // the rows to delete the same way the CSV version compared them.
  const rows = await query<{ symbol: string }>(`select symbol from watchlist`);
  const targets = rows
    .map((row) => row.symbol)
    .filter((item) => normalizeWatchlistSymbol(item) === normalized);

  if (targets.length) {
    try {
      await query(`delete from watchlist where symbol = any($1::text[])`, [targets]);
    } catch (error) {
      throw new Error(
        `Could not delete ${normalized}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return getMyWatchlistSymbols();
}

function uniqueSymbols(symbols: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  symbols.forEach((symbol) => {
    const normalized = normalizeWatchlistSymbol(symbol);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function normalizeWatchlistSymbol(symbol: string) {
  return normalizeSymbol(symbol.trim().toUpperCase());
}
