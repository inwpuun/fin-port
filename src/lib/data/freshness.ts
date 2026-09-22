import "server-only";
import { queryOne } from "@/lib/db/client";

/**
 * When each table's rows last changed, for the "updated" label beside the logo.
 *
 * Reads `updated_at`, which every table maintains: it defaults to now() on
 * insert and the touch_updated_at trigger bumps it on update. Because the
 * importer upserts, a re-import of unchanged rows still moves the timestamp --
 * the label answers "when did this data last get written", not "when did a
 * value last differ".
 */

export type Freshness = {
  holdings: string | null;
  allocations: string | null;
  watchlist: string | null;
  cashBook: string | null;
};

export const emptyFreshness: Freshness = {
  holdings: null,
  allocations: null,
  watchlist: null,
  cashBook: null
};

/**
 * The table name is interpolated, not bound: Postgres has no parameter form
 * for an identifier. Every call site below passes a literal, so nothing that
 * reaches this function came from a request.
 */
async function latest(table: string): Promise<string | null> {
  try {
    const row = await queryOne<{ updated_at: Date | null }>(
      `select max(updated_at) as updated_at from ${table}`
    );
    return row?.updated_at ? row.updated_at.toISOString() : null;
  } catch (error) {
    // A missing timestamp just hides the label; it must never break the page.
    console.error(`freshness lookup failed for ${table}:`, error);
    return null;
  }
}

export async function getDataFreshness(): Promise<Freshness> {
  const [holdings, allocations, watchlist, cashBook] = await Promise.all([
    latest("holdings"),
    latest("allocations"),
    latest("watchlist"),
    latest("cash_transactions")
  ]);

  return { holdings, allocations, watchlist, cashBook };
}
