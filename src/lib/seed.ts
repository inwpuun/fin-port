import { parseAmount, parseCsvRecords } from "@/lib/csv";
import { buildUpsert, type Db } from "@/lib/db/sql";

/**
 * One-shot importers that move the original CSVs into Postgres. Same upsert
 * discipline as the cash book: the natural key of each sheet is its unique
 * constraint, so re-running is idempotent.
 *
 * Takes the connection as an argument rather than reaching for the app pool,
 * so scripts/import.ts can run these under tsx with its own one-shot client.
 */

export type SeedCount = { table: string; rows: number };

/** data/my-port.csv -> holdings. "cost basis" is the position total, not a unit price. */
export async function importHoldings(client: Db, csv: string): Promise<SeedCount> {
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

  const { text, values } = buildUpsert(
    "holdings",
    ["symbol", "quantity", "cost_basis", "cost_currency", "sort_order"],
    rows,
    { conflict: ["symbol"] }
  );

  try {
    await client.query(text, values);
  } catch (error) {
    throw new Error(`holdings upsert failed: ${message(error)}`);
  }

  return { table: "holdings", rows: rows.length };
}

/** data/my-allocation.csv -> allocations. */
export async function importAllocations(client: Db, csv: string): Promise<SeedCount> {
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

  const { text, values } = buildUpsert(
    "allocations",
    ["category", "symbol", "cash_value", "cash_currency", "sort_order"],
    rows,
    { conflict: ["category", "symbol"] }
  );

  try {
    await client.query(text, values);
  } catch (error) {
    throw new Error(`allocations upsert failed: ${message(error)}`);
  }

  return { table: "allocations", rows: rows.length };
}

/** data/my-watchlist.csv -> watchlist. */
export async function importWatchlist(client: Db, csv: string): Promise<SeedCount> {
  const rows = parseCsvRecords(csv)
    .map((record, index) => ({
      symbol: (record.symbol || "").toUpperCase(),
      sort_order: index
    }))
    .filter((row) => row.symbol);

  if (!rows.length) return { table: "watchlist", rows: 0 };

  const { text, values } = buildUpsert("watchlist", ["symbol", "sort_order"], rows, {
    conflict: ["symbol"]
  });

  try {
    await client.query(text, values);
  } catch (error) {
    throw new Error(`watchlist upsert failed: ${message(error)}`);
  }

  return { table: "watchlist", rows: rows.length };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
