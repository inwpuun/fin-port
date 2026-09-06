import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { buildPortfolioView } from "@/lib/data/portfolio-view";
import { drawdownRanges, normalizeDrawdownRange } from "@/lib/market";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams
}: {
  searchParams: Promise<{ drawdownRange?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const drawdownRange = normalizeDrawdownRange(params.drawdownRange);
  const view = await buildPortfolioView(drawdownRange);

  return (
    <PortfolioDashboard
      view={view}
      drawdownRange={drawdownRange}
      drawdownRanges={drawdownRanges}
      drawdownLimit={params.limit ?? "12"}
    />
  );
}
