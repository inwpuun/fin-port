import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { getMyPortfolioSeed } from "@/lib/my-port";

export default async function PortfolioPage() {
  const defaultPortfolio = await getMyPortfolioSeed();

  return <PortfolioDashboard defaultPortfolio={defaultPortfolio} />;
}
