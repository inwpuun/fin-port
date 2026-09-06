import Link from "next/link";
import { CashBookImport } from "@/components/cash-book-import";
import { currencyFormat } from "@/lib/format";
import {
  DEFAULT_PAGE_SIZE,
  availableYears,
  categoryTotals,
  listCashAccounts,
  listTransactions,
  monthlySummary
} from "@/lib/data/cash-book";

export const dynamic = "force-dynamic";

type Search = {
  year?: string;
  account?: string;
  category?: string;
  q?: string;
  page?: string;
};

const BAHT = "THB";

function monthLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

export default async function CashBookPage({
  searchParams
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;

  const year = params.year && /^\d{4}$/.test(params.year) ? Number(params.year) : null;
  const account = params.account?.trim() || null;
  const category = params.category?.trim() || null;
  const search = params.q?.trim() || null;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [years, accounts, categories, months, txPage] = await Promise.all([
    availableYears(),
    listCashAccounts(),
    categoryTotals(year),
    monthlySummary(year),
    listTransactions({ year, account, category, search, page })
  ]);

  const periodIncome = months.reduce((sum, month) => sum + month.income, 0);
  const periodExpense = months.reduce((sum, month) => sum + month.expense, 0);
  const periodNet = periodIncome - periodExpense;
  const peakFlow = Math.max(1, ...months.map((month) => Math.max(month.income, month.expense)));

  const totalPages = Math.max(1, Math.ceil(txPage.total / txPage.pageSize));
  const pageHref = (next: number) => {
    const query = new URLSearchParams();
    if (year) query.set("year", String(year));
    if (account) query.set("account", account);
    if (category) query.set("category", category);
    if (search) query.set("q", search);
    if (next > 1) query.set("page", String(next));
    const suffix = query.toString();
    return suffix ? `/cash-book?${suffix}` : "/cash-book";
  };

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
        <article className="glass-panel overflow-hidden rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Cash Book</p>
          <h1 className="max-w-4xl font-serif text-5xl leading-none md:text-7xl">
            Every baht in and out.
          </h1>
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            <Tile title={year ? `Income ${year}` : "Income, all time"} value={currencyFormat(periodIncome, BAHT)} tone="text-mint-signal" />
            <Tile title={year ? `Expense ${year}` : "Expense, all time"} value={currencyFormat(periodExpense, BAHT)} tone="text-rose-signal" />
            <Tile title="Net" value={currencyFormat(periodNet, BAHT)} tone={periodNet >= 0 ? "text-mint-signal" : "text-rose-signal"} />
            <Tile title="Transactions" value={txPage.total.toLocaleString("en-US")} />
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Income and expense exclude transfers between your own accounts, which would otherwise
            count the same baht twice. Transfers still appear in the ledger below.
          </p>
        </article>

        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Accounts</p>
          <h2 className="mb-4 text-2xl font-black">Latest balances</h2>
          <div className="grid gap-2">
            {accounts.map((item) => (
              <div key={item.id} className="flex items-baseline justify-between gap-3 border-b border-white/8 pb-2 last:border-0">
                <span className="text-sm">
                  {item.name}
                  {item.balanceYear ? <small className="ml-2 text-slate-500">{item.balanceYear}</small> : null}
                </span>
                <strong
                  className={`text-sm ${
                    (item.currentBalance ?? 0) < 0 ? "text-rose-signal" : "text-slate-200"
                  }`}
                >
                  {item.currentBalance == null
                    ? "N/A"
                    : currencyFormat(item.currentBalance, item.currency || BAHT)}
                </strong>
              </div>
            ))}
            {accounts.length === 0 ? (
              <p className="text-sm text-slate-400">
                No accounts yet. Import an export below, or run{" "}
                <code className="text-cyan-signal">npm run db:cash-book</code>.
              </p>
            ) : null}
          </div>
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-[390px_1fr]">
        <div className="grid gap-4">
          <CashBookImport />

          <section className="glass-panel rounded-3xl p-6">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Filter</p>
            <h2 className="mb-4 text-2xl font-black">Narrow the ledger</h2>

            <form method="get" action="/cash-book" className="grid gap-3">
              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Year</span>
                <select id="year" name="year" defaultValue={year ?? ""} className="bg-transparent text-lg outline-none">
                  <option className="bg-panel" value="">All years</option>
                  {years.map((item) => (
                    <option className="bg-panel" key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Account</span>
                <select id="account" name="account" defaultValue={account ?? ""} className="bg-transparent text-lg outline-none">
                  <option className="bg-panel" value="">All accounts</option>
                  {accounts.map((item) => (
                    <option className="bg-panel" key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Category</span>
                <select id="category" name="category" defaultValue={category ?? ""} className="bg-transparent text-lg outline-none">
                  <option className="bg-panel" value="">All categories</option>
                  {categories.map((item) => (
                    <option className="bg-panel" key={item.category} value={item.category}>
                      {item.category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-shell grid gap-1 rounded-2xl px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Description or memo
                </span>
                <input
                  id="q"
                  name="q"
                  defaultValue={search ?? ""}
                  placeholder="coffee"
                  className="bg-transparent text-lg outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button className="min-h-12 rounded-2xl bg-gradient-to-r from-white to-[#8af5d6] font-black text-[#05110e]">
                  Apply
                </button>
                <Link
                  href="/cash-book"
                  className="grid min-h-12 place-items-center rounded-2xl border border-white/10 bg-white/5 font-bold text-slate-300 no-underline hover:text-white"
                >
                  Reset
                </Link>
              </div>
            </form>
          </section>

          <section className="glass-panel rounded-3xl p-6">
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Categories</p>
            <h2 className="mb-4 text-2xl font-black">Where it goes</h2>
            <div className="grid gap-3">
              {categories.slice(0, 10).map((item) => (
                <div key={item.category}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <strong className="text-sm">{item.category}</strong>
                    <span className="text-sm text-slate-400">{currencyFormat(item.expense, BAHT)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-signal to-amber-signal"
                      style={{
                        width: `${Math.min(100, (item.expense / Math.max(1, categories[0]?.expense ?? 1)) * 100)}%`
                      }}
                    />
                  </div>
                  <small className="text-slate-500">{item.txCount} transactions</small>
                </div>
              ))}
              {categories.length === 0 ? (
                <p className="text-sm text-slate-400">Nothing imported yet.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="grid gap-4">
          <section className="glass-panel rounded-3xl p-6">
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">Monthly flow</p>
            <h2 className="mb-5 text-2xl font-black">Income against expense</h2>

            <div className="grid gap-2">
              {months.slice(0, 14).map((month) => (
                <div key={month.month} className="grid grid-cols-[92px_1fr_auto] items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    {monthLabel(month.month)}
                  </span>
                  <div className="grid gap-1">
                    <div className="h-2 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-mint-signal/80"
                        style={{ width: `${(month.income / peakFlow) * 100}%` }}
                      />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-rose-signal/80"
                        style={{ width: `${(month.expense / peakFlow) * 100}%` }}
                      />
                    </div>
                  </div>
                  <strong className={`text-sm ${month.net >= 0 ? "text-mint-signal" : "text-rose-signal"}`}>
                    {currencyFormat(month.net, BAHT)}
                  </strong>
                </div>
              ))}
              {months.length === 0 ? (
                <p className="text-sm text-slate-400">No transactions for this filter.</p>
              ) : null}
            </div>
          </section>

          <section className="glass-panel overflow-hidden rounded-3xl">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 p-6">
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
                  Transactions
                </p>
                <h2 className="text-2xl font-black">
                  {txPage.total.toLocaleString("en-US")} rows
                  {year ? ` in ${year}` : ""}
                </h2>
              </div>
              <span className="text-sm text-slate-400">
                Page {txPage.page} of {totalPages}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4">Account</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                    <th className="px-6 py-4 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {txPage.rows.map((row) => (
                    <tr key={row.id} className="border-t border-white/10">
                      <td className="whitespace-nowrap px-6 py-3 text-sm">
                        {row.occurredOn}
                        {row.occurredAt ? (
                          <small className="ml-2 text-slate-500">{row.occurredAt.slice(0, 5)}</small>
                        ) : null}
                      </td>
                      <td className="px-6 py-3">
                        <span className="block text-sm">{row.description || "—"}</span>
                        {row.memo ? <small className="text-slate-500">{row.memo}</small> : null}
                        {row.transferAccount ? (
                          <small className="block text-cyan-signal/80">to/from {row.transferAccount}</small>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-300">
                        {row.category ?? "—"}
                        {row.subcategory ? (
                          <small className="block text-slate-500">{row.subcategory}</small>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 text-sm text-slate-300">{row.account}</td>
                      <td
                        className={`whitespace-nowrap px-6 py-3 text-right font-black ${
                          row.amount >= 0 ? "text-mint-signal" : "text-rose-signal"
                        }`}
                      >
                        {currencyFormat(row.amount, row.currency || BAHT)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right text-sm text-slate-400">
                        {row.runningBalance == null
                          ? "—"
                          : currencyFormat(row.runningBalance, row.currency || BAHT)}
                      </td>
                    </tr>
                  ))}
                  {txPage.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                        Nothing matches this filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 border-t border-white/10 p-6">
                {txPage.page > 1 ? (
                  <Link
                    href={pageHref(txPage.page - 1)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 no-underline hover:text-white"
                  >
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-slate-500">
                  {txPage.pageSize} per page · {DEFAULT_PAGE_SIZE === txPage.pageSize ? "default" : "custom"}
                </span>
                {txPage.page < totalPages ? (
                  <Link
                    href={pageHref(txPage.page + 1)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 no-underline hover:text-white"
                  >
                    Next
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}

function Tile({ title, value, tone = "text-white" }: { title: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</span>
      <strong className={`mt-2 block text-2xl font-black ${tone}`}>{value}</strong>
    </div>
  );
}
