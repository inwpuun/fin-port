import "server-only";
import { normalizeSymbol } from "@/lib/market";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Watchlist storage. Exported surface is unchanged from the CSV version; only
 * the backing store moved to Postgres, which also makes writes work on Vercel
 * (the serverless filesystem is read-only, so writeFile always failed there).
 */

const fallbackWatchlistSymbols = ["AAPL", "MSFT", "NVDA", "VOO", "BTC-USD", "GC=F"];

export async function getMyWatchlistSymbols(): Promise<string[]> {
  let data;

  try {
    const result = await supabaseAdmin()
      .from("watchlist")
      .select("symbol, sort_order")
      .order("sort_order", { ascending: true });

    if (result.error) throw new Error(result.error.message);
    data = result.data;
  } catch (error) {
    // Deliberately NOT falling back to the starter symbols here. Substituting
    // a plausible list on a connection or credential failure made a broken
    // deployment look healthy: the watchlist rendered six sensible tickers
    // while holdings and allocations came back empty, which reads as "the
    // holdings table is broken" instead of "the database is unreachable".
    console.error("getMyWatchlistSymbols failed:", error);
    return [];
  }

  // Only a genuinely empty table gets the starter list.
  const symbols = uniqueSymbols((data ?? []).map((row) => row.symbol as string));
  return symbols.length ? symbols : fallbackWatchlistSymbols;
}

export async function upsertMyWatchlistSymbol(symbol: string): Promise<string[]> {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");

  // The CSV version prepended the new symbol. Reproduce that ordering by
  // giving it a sort_order below every existing row.
  const { data: head } = await supabaseAdmin()
    .from("watchlist")
    .select("sort_order")
    .order("sort_order", { ascending: true })
    .limit(1);

  const lowest = Number(head?.[0]?.sort_order ?? 0);

  const { error } = await supabaseAdmin()
    .from("watchlist")
    .upsert({ symbol: normalized, sort_order: lowest - 1 }, { onConflict: "symbol" });

  if (error) throw new Error(`Could not save ${normalized}: ${error.message}`);
  return getMyWatchlistSymbols();
}

export async function deleteMyWatchlistSymbol(symbol: string): Promise<string[]> {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");

  // Stored symbols may predate normalization ("BRK.B" vs "BRK-B"), so resolve
  // the rows to delete the same way the CSV version compared them.
  const { data } = await supabaseAdmin().from("watchlist").select("symbol");
  const targets = (data ?? [])
    .map((row) => row.symbol as string)
    .filter((item) => normalizeWatchlistSymbol(item) === normalized);

  if (targets.length) {
    const { error } = await supabaseAdmin().from("watchlist").delete().in("symbol", targets);
    if (error) throw new Error(`Could not delete ${normalized}: ${error.message}`);
  }

  return getMyWatchlistSymbols();
}

export function upsertWatchlistSymbol(current: string[], symbol: string) {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");
  return uniqueSymbols([normalized, ...current]);
}

export function deleteWatchlistSymbol(current: string[], symbol: string) {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");
  return current.filter((item) => normalizeWatchlistSymbol(item) !== normalized);
}

/** Still used to export the watchlist back out as a CSV download. */
export function serializeMyWatchlistCsv(symbols: string[]) {
  const rows = uniqueSymbols(symbols).map(escapeCsvValue);
  return `symbol\n${rows.join("\n")}\n`;
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

function escapeCsvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}
