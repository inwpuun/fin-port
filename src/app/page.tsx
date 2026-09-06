import { MarketDashboard } from "@/components/market-dashboard";
import { listWatchlist } from "@/lib/data/portfolio";

export const dynamic = "force-dynamic";

const fallbackSymbols = ["AAPL", "MSFT", "GC=F", "BTC-USD", "^GSPC", "^IXIC"];

export default async function HomePage() {
  const items = await listWatchlist();
  const symbols = items.map((item) => item.symbol);

  return <MarketDashboard initialWatchlist={symbols.length ? symbols : fallbackSymbols} />;
}
