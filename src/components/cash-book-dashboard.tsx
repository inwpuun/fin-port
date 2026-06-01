"use client";

import { Fragment, useMemo, useState } from "react";
import { currencyFormat } from "@/lib/format";
import type { CashBookFlowType, CashBookTransaction } from "@/types/cash-book";

type YearFilter = number | "all";
type ChartPeriod = "day" | "month" | "year";
type DescriptionFilter = CashBookFlowType | "all";
type CashBookSubpage = "overview" | "categories" | "graph" | "descriptions";

type AmountBucket = {
  income: number;
  expense: number;
  count: number;
};

type CategoryRow = {
  category: string;
  group: string;
  months: Map<string, AmountBucket>;
  income: number;
  expense: number;
  net: number;
  count: number;
  transactions: CashBookTransaction[];
};

type DescriptionRow = {
  description: string;
  categories: string[];
  income: number;
  expense: number;
  net: number;
  count: number;
  latestDate: string;
};

type ChartCategory = {
  category: string;
  group: string;
  total: number;
  color: string;
};

type ChartSegment = {
  category: string;
  group: string;
  value: number;
  color: string;
};

type ChartRow = {
  key: string;
  label: string;
  total: number;
  segments: ChartSegment[];
};

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const chartPeriods: Array<{ value: ChartPeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" }
];
const descriptionFilters: Array<{ value: DescriptionFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" }
];
const cashBookSubpages: Array<{ value: CashBookSubpage; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "categories", label: "Categories" },
  { value: "graph", label: "Graph" },
  { value: "descriptions", label: "Descriptions" }
];
const groupColors = ["#52d6ff", "#14ce99", "#ffcc66", "#ff5278", "#a78bfa", "#f97316", "#e5e7eb", "#38bdf8"];

export function CashBookDashboard({ transactions }: { transactions: CashBookTransaction[] }) {
  const availableYears = useMemo(() => getAvailableYears(transactions), [transactions]);
  const [selectedYear, setSelectedYear] = useState<YearFilter>(() => availableYears[0] || "all");
  const [expandedCategory, setExpandedCategory] = useState("");
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("month");
  const [chartCategory, setChartCategory] = useState("all");
  const [selectedChartKey, setSelectedChartKey] = useState("");
  const [descriptionFilter, setDescriptionFilter] = useState<DescriptionFilter>("expense");
  const [activeSubpage, setActiveSubpage] = useState<CashBookSubpage>("overview");

  const filteredTransactions = useMemo(() => {
    if (selectedYear === "all") return transactions;
    return transactions.filter((transaction) => transaction.year === selectedYear);
  }, [selectedYear, transactions]);

  const monthColumns = useMemo(() => buildMonthColumns(filteredTransactions, selectedYear), [filteredTransactions, selectedYear]);
  const totals = useMemo(() => summarizeTransactions(filteredTransactions), [filteredTransactions]);
  const yearRows = useMemo(() => buildYearRows(transactions), [transactions]);
  const categoryRows = useMemo(() => buildCategoryRows(filteredTransactions, "category", "alpha"), [filteredTransactions]);
  const groupRows = useMemo(() => buildCategoryRows(filteredTransactions, "group", "expense"), [filteredTransactions]);
  const descriptionRows = useMemo(() => buildDescriptionRows(filteredTransactions, descriptionFilter), [descriptionFilter, filteredTransactions]);
  const chartCategories = useMemo(() => buildChartCategories(filteredTransactions), [filteredTransactions]);
  const categoryOptions = useMemo(() => chartCategories.map((row) => row.category), [chartCategories]);
  const activeChartCategory = chartCategory === "all" || categoryOptions.includes(chartCategory) ? chartCategory : "all";
  const chartRows = useMemo(
    () => buildChartRows(filteredTransactions, chartPeriod, activeChartCategory, chartCategories),
    [activeChartCategory, chartCategories, chartPeriod, filteredTransactions]
  );
  const selectedChartRow = selectedChartKey ? chartRows.find((row) => row.key === selectedChartKey) || null : null;
  const expenseMix = useMemo(() => buildExpenseMixRows(chartCategories, selectedChartRow).slice(0, 10), [chartCategories, selectedChartRow]);
  const expenseMixTotal = selectedChartRow?.total || totals.expense;
  const maxChartValue = Math.max(...chartRows.map((row) => row.total), 0);
  const topExpenseGroup = groupRows.find((row) => row.expense > 0);
  const selectedYearLabel = selectedYear === "all" ? "All years" : String(selectedYear);

  function selectYear(year: YearFilter) {
    setSelectedChartKey("");
    setExpandedCategory("");
    setSelectedYear(year);
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <article className="glass-panel animate-rise-in overflow-hidden rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Cash Book</p>
          <h1 className="max-w-full break-words font-serif text-4xl leading-none sm:text-5xl md:text-7xl">Cash flow ledger by month, memo, and category.</h1>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <Metric title="Income" value={money(totals.income)} tone="text-mint-signal" />
            <Metric title="Expense" value={money(totals.expense)} tone="text-rose-signal" />
            <Metric title="Net" value={money(totals.net)} tone={totals.net >= 0 ? "text-cyan-signal" : "text-amber-signal"} />
            <Metric title="Top Expense" value={topExpenseGroup?.category || "None"} tone="text-amber-signal" />
          </div>
        </article>

        <section className="glass-panel rounded-3xl p-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Source</p>
          <h2 className="mb-4 text-2xl font-black">public/cash-book</h2>
          <div className="grid gap-3 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span>Files</span>
              <strong className="text-white">{new Set(transactions.map((transaction) => transaction.file)).size}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span>Transactions</span>
              <strong className="text-white">{numberFormat(filteredTransactions.length)}</strong>
            </div>
          </div>
        </section>
      </section>

      <section className="glass-panel sticky top-4 z-30 rounded-3xl p-3 shadow-[0_22px_60px_rgba(0,0,0,.38)]">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex flex-wrap gap-2">
            {availableYears.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => selectYear(year)}
                className={chipClass(selectedYear === year)}
              >
                {year}
              </button>
            ))}
            <button
              type="button"
              onClick={() => selectYear("all")}
              className={chipClass(selectedYear === "all")}
            >
              All years
            </button>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Cash book sections">
            {cashBookSubpages.map((subpage) => (
              <button
                key={subpage.value}
                type="button"
                onClick={() => setActiveSubpage(subpage.value)}
                className={chipClass(activeSubpage === subpage.value)}
              >
                {subpage.label}
              </button>
            ))}
          </nav>
        </div>
        </section>

      {activeSubpage === "overview" && (
        <>
          <section className="glass-panel overflow-hidden rounded-3xl">
            <SectionHeading eyebrow="Year Close" title="Income, expense, and net by year" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-6 py-4">Year</th>
                    <th className="px-6 py-4">Income</th>
                    <th className="px-6 py-4">Expense</th>
                    <th className="px-6 py-4">Net</th>
                    <th className="px-6 py-4">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows.map((row) => (
                    <tr key={row.year} className="border-t border-white/10">
                      <td className="px-6 py-4 font-black">{row.year}</td>
                      <td className="px-6 py-4 font-black text-mint-signal">{money(row.income)}</td>
                      <td className="px-6 py-4 font-black text-rose-signal">{money(row.expense)}</td>
                      <td className={`px-6 py-4 font-black ${row.net >= 0 ? "text-cyan-signal" : "text-amber-signal"}`}>{money(row.net)}</td>
                      <td className="px-6 py-4 text-slate-300">{numberFormat(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="glass-panel overflow-hidden rounded-3xl">
            <SectionHeading eyebrow={`${selectedYearLabel} Group Summary`} title="Monthly conclusion by cash group" />
            <MonthTable rows={groupRows} columns={monthColumns} labelHeader="Group" />
          </section>
        </>
      )}

      {activeSubpage === "categories" && (
        <section className="glass-panel overflow-hidden rounded-3xl">
          <SectionHeading eyebrow={`${selectedYearLabel} Category Matrix`} title="Income and expense by category" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="sticky left-0 z-10 bg-panel/95 px-6 py-4">Category</th>
                {monthColumns.map((column) => (
                  <th key={column.key} className="px-4 py-4 text-right">
                    {column.label}
                  </th>
                ))}
                <th className="px-4 py-4 text-right">Income</th>
                <th className="px-4 py-4 text-right">Expense</th>
                <th className="px-4 py-4 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => (
                <Fragment key={row.category}>
                  <tr key={row.category} className="border-t border-white/10">
                    <td className="sticky left-0 z-10 bg-panel/95 px-6 py-4">
                      <button
                        type="button"
                        aria-expanded={expandedCategory === row.category}
                        onClick={() => setExpandedCategory((current) => (current === row.category ? "" : row.category))}
                        className="group flex w-full min-w-[260px] items-center gap-3 text-left"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 font-black text-cyan-signal">
                          {expandedCategory === row.category ? "-" : "+"}
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate text-white">{row.category}</strong>
                          <small className="text-slate-400">{row.group} / {numberFormat(row.count)} tx</small>
                        </span>
                      </button>
                    </td>
                    {monthColumns.map((column) => (
                      <td key={column.key} className="px-4 py-4 text-right">
                        <AmountPair bucket={row.months.get(column.key)} />
                      </td>
                    ))}
                    <td className="px-4 py-4 text-right font-black text-mint-signal">{compactMoney(row.income)}</td>
                    <td className="px-4 py-4 text-right font-black text-rose-signal">{compactMoney(row.expense)}</td>
                    <td className={`px-4 py-4 text-right font-black ${row.net >= 0 ? "text-cyan-signal" : "text-amber-signal"}`}>
                      {compactMoney(row.net)}
                    </td>
                  </tr>
                  {expandedCategory === row.category && (
                    <tr key={`${row.category}-transactions`} className="border-t border-white/10 bg-white/[0.03]">
                      <td colSpan={monthColumns.length + 4} className="px-6 py-5">
                        <div className="grid max-h-[380px] gap-3 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                          {row.transactions.map((transaction) => (
                            <article key={transaction.id} className="rounded-2xl border border-white/10 bg-void/35 p-4" title={transaction.memo || transaction.description}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <strong className="block truncate">{transaction.description}</strong>
                                  <span className="text-sm text-slate-400">
                                    {transaction.dateLabel} {transaction.time}
                                  </span>
                                </div>
                                <span className={`whitespace-nowrap text-sm font-black ${transaction.type === "income" ? "text-mint-signal" : "text-rose-signal"}`}>
                                  {money(transaction.amount)}
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{transaction.account || "Account"}</span>
                                {transaction.transferAccount && <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{transaction.transferAccount}</span>}
                                <MemoTooltip memo={transaction.memo} />
                              </div>
                            </article>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeSubpage === "graph" && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="flex flex-col gap-4 border-b border-white/10 p-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">{selectedYearLabel} Expense Graph</p>
              <h2 className="text-2xl font-black">Compare spending by period</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {chartPeriods.map((period) => (
                <button
                  key={period.value}
                  type="button"
                  onClick={() => {
                    setSelectedChartKey("");
                    setChartPeriod(period.value);
                  }}
                  className={chipClass(chartPeriod === period.value)}
                >
                  {period.label}
                </button>
              ))}
              <label className="field-shell grid min-w-[180px] gap-1 rounded-2xl px-4 py-2">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Category</span>
                <select
                  value={activeChartCategory}
                  onChange={(event) => {
                    setSelectedChartKey("");
                    setChartCategory(event.target.value);
                  }}
                  className="bg-transparent text-sm font-bold outline-none"
                  aria-label="Expense chart category"
                >
                  <option className="bg-panel" value="all">All categories</option>
                  {categoryOptions.map((category) => (
                    <option className="bg-panel" key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <ExpenseChart
            rows={chartRows}
            categories={chartCategories}
            selectedCategory={activeChartCategory}
            selectedRowKey={selectedChartRow?.key || ""}
            maxValue={maxChartValue}
            onSelectCategory={(category) => {
              setSelectedChartKey("");
              setChartCategory(category);
            }}
            onSelectRow={setSelectedChartKey}
          />
        </section>

        <section className="glass-panel rounded-3xl p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
                {selectedChartRow ? selectedChartRow.label : selectedYearLabel} Expense Mix
              </p>
              <h2 className="text-2xl font-black">Category summary</h2>
            </div>
            {selectedChartRow && (
              <button type="button" onClick={() => setSelectedChartKey("")} className={chipClass(false)}>
                All periods
              </button>
            )}
          </div>
          <div className="grid gap-3">
            {expenseMix.map((row) => (
              <div key={row.category} className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
                    <strong className="truncate">{row.category}</strong>
                  </span>
                  <span className="whitespace-nowrap text-sm font-black text-slate-300">{money(row.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-rose-signal via-amber-signal to-cyan-signal" style={{ width: `${percentage(row.value, expenseMixTotal)}%` }} />
                </div>
              </div>
            ))}
            {!expenseMix.length && <p className="text-sm text-slate-400">No expense rows in this period.</p>}
          </div>
        </section>
      </section>
      )}

      {activeSubpage === "descriptions" && (
        <section className="glass-panel overflow-hidden rounded-3xl">
        <div className="flex flex-col gap-4 border-b border-white/10 p-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">{selectedYearLabel} Description Rollup</p>
            <h2 className="text-2xl font-black">Income or expense by transaction description</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {descriptionFilters.map((filter) => (
              <button key={filter.value} type="button" onClick={() => setDescriptionFilter(filter.value)} className={chipClass(descriptionFilter === filter.value)}>
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4 text-right">Income</th>
                <th className="px-6 py-4 text-right">Expense</th>
                <th className="px-6 py-4 text-right">Net</th>
                <th className="px-6 py-4 text-right">Count</th>
                <th className="px-6 py-4">Latest</th>
              </tr>
            </thead>
            <tbody>
              {descriptionRows.map((row) => (
                <tr key={row.description} className="border-t border-white/10">
                  <td className="px-6 py-4 font-black">{row.description}</td>
                  <td className="px-6 py-4 text-slate-300">{row.categories.join(", ")}</td>
                  <td className="px-6 py-4 text-right font-black text-mint-signal">{money(row.income)}</td>
                  <td className="px-6 py-4 text-right font-black text-rose-signal">{money(row.expense)}</td>
                  <td className={`px-6 py-4 text-right font-black ${row.net >= 0 ? "text-cyan-signal" : "text-amber-signal"}`}>{money(row.net)}</td>
                  <td className="px-6 py-4 text-right text-slate-300">{numberFormat(row.count)}</td>
                  <td className="px-6 py-4 text-slate-300">{row.latestDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-white/10 p-6">
      <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">{eyebrow}</p>
      <h2 className="text-2xl font-black">{title}</h2>
    </div>
  );
}

function Metric({ title, value, tone = "text-white" }: { title: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</span>
      <strong className={`mt-2 block break-words text-xl font-black leading-tight sm:text-2xl ${tone}`}>{value}</strong>
    </div>
  );
}

function MonthTable({ rows, columns, labelHeader }: { rows: CategoryRow[]; columns: Array<{ key: string; label: string }>; labelHeader: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] border-collapse text-left">
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="sticky left-0 z-10 bg-panel/95 px-6 py-4">{labelHeader}</th>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-4 text-right">
                {column.label}
              </th>
            ))}
            <th className="px-4 py-4 text-right">Income</th>
            <th className="px-4 py-4 text-right">Expense</th>
            <th className="px-4 py-4 text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className="border-t border-white/10">
              <td className="sticky left-0 z-10 bg-panel/95 px-6 py-4">
                <span className="flex min-w-[180px] items-center gap-3">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorForGroup(row.group) }} />
                  <strong className="truncate">{row.category}</strong>
                </span>
              </td>
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-4 text-right">
                  <AmountPair bucket={row.months.get(column.key)} />
                </td>
              ))}
              <td className="px-4 py-4 text-right font-black text-mint-signal">{compactMoney(row.income)}</td>
              <td className="px-4 py-4 text-right font-black text-rose-signal">{compactMoney(row.expense)}</td>
              <td className={`px-4 py-4 text-right font-black ${row.net >= 0 ? "text-cyan-signal" : "text-amber-signal"}`}>{compactMoney(row.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AmountPair({ bucket }: { bucket?: AmountBucket }) {
  if (!bucket || (!bucket.income && !bucket.expense)) return <span className="text-slate-600">-</span>;

  return (
    <span className="grid gap-1 text-xs leading-tight">
      {bucket.income > 0 && <span className="font-black text-mint-signal">+{compactMoney(bucket.income)}</span>}
      {bucket.expense > 0 && <span className="font-black text-rose-signal">-{compactMoney(bucket.expense)}</span>}
    </span>
  );
}

function MemoTooltip({ memo }: { memo: string }) {
  if (!memo) return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-500">No memo</span>;

  return (
    <span className="group relative inline-flex outline-none" tabIndex={0} title={memo}>
      <span className="rounded-full border border-cyan-signal/25 bg-cyan-signal/10 px-3 py-1 text-cyan-signal">Memo</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-64 rounded-2xl border border-white/10 bg-void px-4 py-3 text-left text-sm text-white opacity-0 shadow-2xl transition group-hover:opacity-100 group-focus:opacity-100"
      >
        {memo}
      </span>
    </span>
  );
}

function ExpenseChart({
  rows,
  categories,
  selectedCategory,
  selectedRowKey,
  maxValue,
  onSelectCategory,
  onSelectRow
}: {
  rows: ChartRow[];
  categories: ChartCategory[];
  selectedCategory: string;
  selectedRowKey: string;
  maxValue: number;
  onSelectCategory: (category: string) => void;
  onSelectRow: (key: string) => void;
}) {
  if (!rows.length) {
    return <div className="grid min-h-[320px] place-items-center p-6 text-slate-400">No expense data in this view.</div>;
  }

  const axisTicks = buildAxisTicks(maxValue);
  const legendCategories = selectedCategory === "all" ? categories : categories.filter((category) => category.category === selectedCategory);
  const chartMinWidth = Math.max(760, rows.length * 56);

  return (
    <div className="overflow-x-auto p-6">
      <div className="grid gap-4" style={{ minWidth: chartMinWidth }}>
        <div className="grid grid-cols-[76px_1fr] gap-4">
          <div className="relative h-[320px]" aria-hidden="true">
            {axisTicks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] font-black text-slate-500"
                style={{ bottom: `${axisPosition(tick, maxValue)}%` }}
              >
                {axisMoney(tick)}
              </span>
            ))}
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[300px]" aria-hidden="true">
              {axisTicks.map((tick) => (
                <span
                  key={tick}
                  className="absolute left-0 right-0 border-t border-white/8"
                  style={{ bottom: `${axisPosition(tick, maxValue)}%` }}
                />
              ))}
            </div>
            <div className="relative grid h-[340px] items-end gap-3 pb-10" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(42px, 1fr))` }}>
              {rows.map((row) => {
                const height = Math.max(3, (row.total / maxValue) * 100);

                return (
                  <div
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedRowKey === row.key}
                    onClick={() => onSelectRow(row.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectRow(row.key);
                      }
                    }}
                    className="group/bar relative grid h-[300px] grid-rows-[1fr_auto] gap-2 text-left outline-none"
                  >
                    <div className="flex items-end">
                      <div
                        className={`relative flex w-full flex-col-reverse rounded-t-xl border bg-white/5 shadow-[0_0_24px_rgba(255,82,120,.12)] transition group-hover/bar:brightness-110 group-focus/bar:ring-2 group-focus/bar:ring-cyan-signal/55 ${
                          selectedRowKey === row.key ? "border-cyan-signal/70" : "border-white/10"
                        }`}
                        style={{ height: `${height}%` }}
                        title={`${row.label} total: ${money(row.total)}`}
                      >
                        {row.segments.map((segment, index) => (
                          <div
                            key={segment.category}
                            className="group/segment relative w-full transition hover:brightness-125"
                            style={{
                              height: `${(segment.value / row.total) * 100}%`,
                              background: segment.color,
                              borderTopLeftRadius: index === row.segments.length - 1 ? "0.75rem" : 0,
                              borderTopRightRadius: index === row.segments.length - 1 ? "0.75rem" : 0
                            }}
                            title={`${segment.category}: ${money(segment.value)} / ${row.label} total ${money(row.total)}`}
                          >
                            <span className="pointer-events-none absolute left-1/2 top-1/2 z-40 hidden min-w-52 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-void px-3 py-2 text-xs font-black text-white shadow-2xl group-hover/segment:block">
                              {segment.category}: {money(segment.value)}
                              <br />
                              {row.label} total: {money(row.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <span className="absolute -bottom-10 left-1/2 min-h-9 w-16 -translate-x-1/2 break-words text-center text-[11px] font-bold leading-tight text-slate-400">
                      {row.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-20">
          {legendCategories.map((category) => (
            <button
              key={category.category}
              type="button"
              onClick={() => onSelectCategory(category.category)}
              className={legendChipClass(selectedCategory === category.category)}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: category.color }} />
              {category.category}
            </button>
          ))}
          {selectedCategory !== "all" && (
            <button type="button" onClick={() => onSelectCategory("all")} className={legendChipClass(false)}>
              All categories
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function buildCategoryRows(transactions: CashBookTransaction[], mode: "category" | "group" = "category", sort: "alpha" | "expense" = "expense") {
  const rows = new Map<string, CategoryRow>();

  transactions.forEach((transaction) => {
    const key = mode === "group" ? transaction.categoryGroup : transaction.category;
    const current = rows.get(key) || {
      category: key,
      group: transaction.categoryGroup,
      months: new Map<string, AmountBucket>(),
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
      transactions: []
    };

    addAmount(current, transaction);
    rows.set(key, current);
  });

  return Array.from(rows.values()).sort((first, second) => {
    if (sort === "alpha") return first.category.localeCompare(second.category);
    return second.expense - first.expense || second.income - first.income || first.category.localeCompare(second.category);
  });
}

function addAmount(row: CategoryRow, transaction: CashBookTransaction) {
  const month = row.months.get(transaction.monthKey) || { income: 0, expense: 0, count: 0 };

  if (transaction.amount >= 0) {
    row.income += transaction.amount;
    month.income += transaction.amount;
  } else {
    const expense = Math.abs(transaction.amount);
    row.expense += expense;
    month.expense += expense;
  }

  row.net += transaction.amount;
  row.count += 1;
  row.transactions.push(transaction);
  month.count += 1;
  row.months.set(transaction.monthKey, month);
}

function buildDescriptionRows(transactions: CashBookTransaction[], filter: DescriptionFilter) {
  const rows = new Map<string, DescriptionRow>();

  transactions.forEach((transaction) => {
    const key = transaction.description || "Unlabeled transaction";
    const current = rows.get(key) || {
      description: key,
      categories: [],
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
      latestDate: transaction.dateLabel
    };

    if (!current.categories.includes(transaction.category)) current.categories.push(transaction.category);
    if (transaction.amount >= 0) current.income += transaction.amount;
    if (transaction.amount < 0) current.expense += Math.abs(transaction.amount);
    current.net += transaction.amount;
    current.count += 1;
    if (transaction.date > toSortableDate(current.latestDate)) current.latestDate = transaction.dateLabel;
    rows.set(key, current);
  });

  return Array.from(rows.values())
    .filter((row) => (filter === "all" ? true : filter === "income" ? row.income > 0 : row.expense > 0))
    .sort((first, second) => sortValue(second, filter) - sortValue(first, filter) || first.description.localeCompare(second.description));
}

function sortValue(row: DescriptionRow, filter: DescriptionFilter) {
  if (filter === "income") return row.income;
  if (filter === "expense") return row.expense;
  return Math.abs(row.net);
}

function buildYearRows(transactions: CashBookTransaction[]) {
  const rows = new Map<number, AmountBucket & { year: number; net: number }>();

  transactions.forEach((transaction) => {
    const current = rows.get(transaction.year) || { year: transaction.year, income: 0, expense: 0, net: 0, count: 0 };

    if (transaction.amount >= 0) current.income += transaction.amount;
    if (transaction.amount < 0) current.expense += Math.abs(transaction.amount);
    current.net += transaction.amount;
    current.count += 1;
    rows.set(transaction.year, current);
  });

  return Array.from(rows.values()).sort((first, second) => second.year - first.year);
}

function buildMonthColumns(transactions: CashBookTransaction[], selectedYear: YearFilter) {
  if (selectedYear !== "all") {
    return monthLabels.map((label, index) => ({ key: `${selectedYear}-${String(index + 1).padStart(2, "0")}`, label }));
  }

  return Array.from(new Set(transactions.map((transaction) => transaction.monthKey)))
    .sort()
    .map((monthKey) => {
      const [year, month] = monthKey.split("-").map(Number);
      return { key: monthKey, label: `${monthLabels[month - 1]} ${String(year).slice(2)}` };
    });
}

function buildChartCategories(transactions: CashBookTransaction[]) {
  const totals = new Map<string, { category: string; group: string; total: number }>();

  transactions
    .filter((transaction) => transaction.type === "expense")
    .forEach((transaction) => {
      const current = totals.get(transaction.category) || {
        category: transaction.category,
        group: transaction.categoryGroup,
        total: 0
      };

      current.total += Math.abs(transaction.amount);
      totals.set(transaction.category, current);
    });

  return Array.from(totals.values())
    .sort((first, second) => second.total - first.total || first.category.localeCompare(second.category))
    .map((category, index) => ({
      ...category,
      color: categoryColor(index)
    }));
}

function buildChartRows(transactions: CashBookTransaction[], period: ChartPeriod, category: string, categories: ChartCategory[]) {
  const categoryOrder = category === "all" ? categories : categories.filter((item) => item.category === category);
  const rows = new Map<string, { key: string; label: string; segments: Map<string, ChartSegment>; total: number }>();

  transactions
    .filter((transaction) => transaction.type === "expense")
    .filter((transaction) => category === "all" || transaction.category === category)
    .forEach((transaction) => {
      const key = chartKey(transaction, period);
      const categoryMeta = categories.find((item) => item.category === transaction.category);
      const current = rows.get(key) || { key, label: chartLabel(transaction, period), segments: new Map<string, ChartSegment>(), total: 0 };
      const currentSegment = current.segments.get(transaction.category) || {
        category: transaction.category,
        group: transaction.categoryGroup,
        value: 0,
        color: categoryMeta?.color || colorForGroup(transaction.categoryGroup)
      };

      const value = Math.abs(transaction.amount);
      currentSegment.value += value;
      current.total += value;
      current.segments.set(transaction.category, currentSegment);
      rows.set(key, current);
    });

  return Array.from(rows.values())
    .map((row) => ({
      key: row.key,
      label: row.label,
      total: row.total,
      segments: categoryOrder
        .map((orderedCategory) => row.segments.get(orderedCategory.category))
        .filter((segment): segment is ChartSegment => Boolean(segment))
    }))
    .filter((row) => row.total > 0)
    .sort((first, second) => first.key.localeCompare(second.key));
}

function buildExpenseMixRows(categories: ChartCategory[], selectedChartRow: ChartRow | null) {
  const rows = selectedChartRow
    ? selectedChartRow.segments
    : categories.map((category) => ({
        category: category.category,
        group: category.group,
        value: category.total,
        color: category.color
      }));

  return [...rows].sort((first, second) => second.value - first.value || first.category.localeCompare(second.category));
}

function chartKey(transaction: CashBookTransaction, period: ChartPeriod) {
  if (period === "year") return String(transaction.year);
  if (period === "month") return transaction.monthKey;
  return transaction.date;
}

function chartLabel(transaction: CashBookTransaction, period: ChartPeriod) {
  if (period === "year") return String(transaction.year);
  if (period === "month") return `${monthLabels[transaction.month - 1]} ${String(transaction.year).slice(2)}`;
  return `${transaction.day} ${monthLabels[transaction.month - 1]}`;
}

function summarizeTransactions(transactions: CashBookTransaction[]) {
  return transactions.reduce(
    (summary, transaction) => {
      if (transaction.amount >= 0) summary.income += transaction.amount;
      if (transaction.amount < 0) summary.expense += Math.abs(transaction.amount);
      summary.net += transaction.amount;
      return summary;
    },
    { income: 0, expense: 0, net: 0 }
  );
}

function getAvailableYears(transactions: CashBookTransaction[]) {
  return Array.from(new Set(transactions.map((transaction) => transaction.year))).sort((first, second) => second - first);
}

function colorForGroup(group: string) {
  let hash = 0;
  for (let index = 0; index < group.length; index += 1) hash += group.charCodeAt(index);
  return groupColors[hash % groupColors.length];
}

function categoryColor(index: number) {
  return groupColors[index % groupColors.length];
}

function buildAxisTicks(maxValue: number) {
  if (!maxValue) return [0];

  const step = niceStep(maxValue / 4);
  const axisMax = Math.ceil(maxValue / step) * step;

  return [0, step, step * 2, step * 3, axisMax].filter((tick, index, ticks) => tick <= axisMax && ticks.indexOf(tick) === index);
}

function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function axisPosition(value: number, maxValue: number) {
  if (!maxValue) return 0;
  const topTick = Math.max(...buildAxisTicks(maxValue));
  return (value / topTick) * 100;
}

function axisMoney(value: number) {
  if (value >= 1000000) return `THB ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `THB ${Math.round(value / 1000)}K`;
  return `THB ${numberFormat(value)}`;
}

function percentage(value: number, total: number) {
  if (!total) return 0;
  return Math.max(2, Math.min(100, (value / total) * 100));
}

function chipClass(active: boolean) {
  return active
    ? "min-h-10 rounded-2xl border border-cyan-signal/40 bg-cyan-signal/15 px-4 py-2 text-sm font-black text-cyan-signal"
    : "min-h-10 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 transition hover:border-cyan-signal/30 hover:text-white";
}

function legendChipClass(active: boolean) {
  return active
    ? "inline-flex min-h-8 items-center gap-2 rounded-full border border-cyan-signal/40 bg-cyan-signal/15 px-3 py-1 text-xs font-black text-cyan-signal"
    : "inline-flex min-h-8 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-300 transition hover:border-cyan-signal/30 hover:text-white";
}

function money(value: number) {
  return currencyFormat(value, "THB");
}

function compactMoney(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    notation: Math.abs(value) >= 100000 ? "compact" : "standard"
  }).format(value);
}

function numberFormat(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function toSortableDate(dateLabel: string) {
  const [day, month, year] = dateLabel.split("/").map(Number);
  if (!day || !month || !year) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
