import { AllocationDashboard } from "@/components/allocation-dashboard";
import { getUsdThbRateOrNull } from "@/lib/bot-rate";
import { getMyAllocationRules, getMyCashBalances, getMyPortfolioSeed, getMyTransactions } from "@/lib/my-port";

// Reads live rows from Postgres, so it must render per request. Without
// this the page is prerendered at build time and would serve whatever the
// database held during the build -- empty, if the build had no credentials.
export const dynamic = "force-dynamic";

export default async function AllocationPage() {
  const [allocationRules, portfolioSeed, cash, transactions, usdThbRate] = await Promise.all([
    getMyAllocationRules(),
    getMyPortfolioSeed(),
    getMyCashBalances(),
    getMyTransactions(),
    getUsdThbRateOrNull()
  ]);

  return (
    <AllocationDashboard
      allocationRules={allocationRules}
      portfolioSeed={portfolioSeed}
      cash={cash}
      transactions={transactions}
      usdThbRate={usdThbRate}
    />
  );
}
