import { AllocationDashboard } from "@/components/allocation-dashboard";
import { getMyAllocationRules, getMyPortfolioSeed } from "@/lib/my-port";

export default async function AllocationPage() {
  const [allocationRules, portfolioSeed] = await Promise.all([getMyAllocationRules(), getMyPortfolioSeed()]);

  return <AllocationDashboard allocationRules={allocationRules} portfolioSeed={portfolioSeed} />;
}
