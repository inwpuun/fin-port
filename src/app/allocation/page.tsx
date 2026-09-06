import { AllocationDashboard } from "@/components/allocation-dashboard";
import { getMyAllocationRules, getMyPortfolioSeed } from "@/lib/my-port";

// Reads live rows from Postgres, so it must render per request. Without
// this the page is prerendered at build time and would serve whatever the
// database held during the build -- empty, if the build had no credentials.
export const dynamic = "force-dynamic";

export default async function AllocationPage() {
  const [allocationRules, portfolioSeed] = await Promise.all([getMyAllocationRules(), getMyPortfolioSeed()]);

  return <AllocationDashboard allocationRules={allocationRules} portfolioSeed={portfolioSeed} />;
}
