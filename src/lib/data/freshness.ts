import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

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

async function latest(table: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from(table)
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    return (data?.[0]?.updated_at as string | undefined) ?? null;
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
