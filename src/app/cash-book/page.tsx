import { CashBookDashboard } from "@/components/cash-book-dashboard";
import { CashBookImport } from "@/components/cash-book-import";
import { getCashBookTransactions } from "@/lib/cash-book";

export const dynamic = "force-dynamic";

export default async function CashBookPage() {
  const transactions = await getCashBookTransactions();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <CashBookImport />
      <CashBookDashboard transactions={transactions} />
    </div>
  );
}
