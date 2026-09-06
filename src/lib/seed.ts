import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAmount, parseCsvRecords } from "@/lib/csv";

/**
 * One-shot importers that move the original CSVs into Postgres. Same upsert
 * discipline as the cash book: the natural key of each sheet is its unique
 * constraint, so re-running is idempotent.
 */

export type SeedCount = { table: string; rows: number };

/** data/my-port.csv -> holdings. "cost basis" is the position total, not a unit price. */
export async function importHoldings(client: SupabaseClient, csv: string): Promise<SeedCount> {
  const rows = parseCsvRecords(csv)
    .map((record, index) => ({
      symbol: (record.stock || record.symbol || "").toUpperCase(),
      quantity: parseAmount(record.quantity) ?? 0,
      cost_basis: parseAmount(record["cost basis"] ?? record.cost_basis) ?? 0,
      cost_currency: (record["cost currency"] || record.cost_currency || "USD").toUpperCase(),
      sort_order: index
    }))
    .filter((row) => row.symbol && row.quantity > 0);

  if (!rows.length) return { table: "holdings", rows: 0 };

  const { error } = await client.from("holdings").upsert(rows, { onConflict: "symbol" });
  if (error) throw new Error(`holdings upsert failed: ${error.message}`);
  return { table: "holdings", rows: rows.length };
}

/** data/my-allocation.csv -> allocations. */
export async function importAllocations(client: SupabaseClient, csv: string): Promise<SeedCount> {
  const rows = parseCsvRecords(csv)
    .map((record, index) => ({
      category: record.category || "",
      symbol: (record.symbol || "").toUpperCase(),
      cash_value: parseAmount(record["cash value"] ?? record.cash_value),
      cash_currency: (record["cash currency"] || record.cash_currency || "").toUpperCase() || null,
      sort_order: index
    }))
    .filter((row) => row.category && row.symbol);

  if (!rows.length) return { table: "allocations", rows: 0 };

  const { error } = await client
    .from("allocations")
    .upsert(rows, { onConflict: "category,symbol" });
  if (error) throw new Error(`allocations upsert failed: ${error.message}`);
  return { table: "allocations", rows: rows.length };
}

/** data/my-watchlist.csv -> watchlist. */
export async function importWatchlist(client: SupabaseClient, csv: string): Promise<SeedCount> {
  const rows = parseCsvRecords(csv)
    .map((record, index) => ({
      symbol: (record.symbol || "").toUpperCase(),
      sort_order: index
    }))
    .filter((row) => row.symbol);

  if (!rows.length) return { table: "watchlist", rows: 0 };

  const { error } = await client.from("watchlist").upsert(rows, { onConflict: "symbol" });
  if (error) throw new Error(`watchlist upsert failed: ${error.message}`);
  return { table: "watchlist", rows: rows.length };
}
