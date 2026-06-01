import { WatchlistDashboard } from "@/components/watchlist-dashboard";
import { getMyPortfolioSeed } from "@/lib/my-port";

export default async function WatchlistPage() {
  const defaultPortfolio = await getMyPortfolioSeed();
  const defaultSymbols = defaultPortfolio.map((holding) => holding.symbol);

  return <WatchlistDashboard defaultSymbols={defaultSymbols} />;
}
