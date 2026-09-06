import { WatchlistDashboard } from "@/components/watchlist-dashboard";
import { getMyWatchlistSymbols } from "@/lib/my-watchlist";

// Reads live rows from Postgres, so it must render per request. Without
// this the page is prerendered at build time and would serve whatever the
// database held during the build -- empty, if the build had no credentials.
export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const defaultSymbols = await getMyWatchlistSymbols();

  return <WatchlistDashboard defaultSymbols={defaultSymbols} />;
}
