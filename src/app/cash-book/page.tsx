import { CashBookDashboard } from "@/components/cash-book-dashboard";
import { CashBookSync } from "@/components/cash-book-sync";
import { getCashBookTransactions } from "@/lib/cash-book";

export const dynamic = "force-dynamic";

export default async function CashBookPage() {
  const transactions = await getCashBookTransactions();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <CashBookSync />
      <CashBookDashboard transactions={transactions} />
    </div>
  );
}
