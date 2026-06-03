import { WatchlistDashboard } from "@/components/watchlist-dashboard";
import { getMyWatchlistSymbols } from "@/lib/my-watchlist";

export default async function WatchlistPage() {
  const defaultSymbols = await getMyWatchlistSymbols();

  return <WatchlistDashboard defaultSymbols={defaultSymbols} />;
}
