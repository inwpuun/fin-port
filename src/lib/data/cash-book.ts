import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  CashAccount,
  CashTransaction,
  CategoryTotal,
  MonthlySummary
} from "@/types/portfolio";

function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type TransactionFilters = {
  year?: number | null;
  account?: string | null;
  category?: string | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
};

export type TransactionPage = {
  rows: CashTransaction[];
  total: number;
  page: number;
  pageSize: number;
};

export const DEFAULT_PAGE_SIZE = 50;

export async function listTransactions(filters: TransactionFilters = {}): Promise<TransactionPage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;

  let query = supabaseAdmin()
    .from("cash_transactions")
    .select(
      "id, account, transfer_account, description, category, subcategory, occurred_on, occurred_at, memo, amount, currency, running_balance, source_year",
      { count: "exact" }
    )
    .order("occurred_on", { ascending: false })
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (filters.year) {
    query = query
      .gte("occurred_on", `${filters.year}-01-01`)
      .lte("occurred_on", `${filters.year}-12-31`);
  }
  if (filters.account) query = query.eq("account", filters.account);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.search) {
    // Escape PostgREST's or() metacharacters before interpolating user text.
    const term = filters.search.replace(/[(),*]/g, " ").trim();
    if (term) {
      query = query.or(`description.ilike.%${term}%,memo.ilike.%${term}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`listTransactions failed: ${error.message}`);

  const rows: CashTransaction[] = (data ?? []).map((row) => ({
    id: row.id as string,
    account: row.account as string,
    transferAccount: (row.transfer_account as string | null) ?? null,
    description: (row.description as string) ?? "",
    category: (row.category as string | null) ?? null,
    subcategory: (row.subcategory as string | null) ?? null,
    occurredOn: row.occurred_on as string,
    occurredAt: (row.occurred_at as string | null) ?? null,
    memo: (row.memo as string | null) ?? null,
    amount: num(row.amount as string),
    currency: (row.currency as string) ?? "THB",
    runningBalance: nullableNum(row.running_balance as string | null),
    sourceYear: (row.source_year as number | null) ?? null
  }));

  return { rows, total: count ?? 0, page, pageSize };
}

export async function listCashAccounts(): Promise<CashAccount[]> {
  const { data, error } = await supabaseAdmin()
    .from("cash_accounts")
    .select("id, name, currency, current_balance, balance_year")
    .order("name", { ascending: true });

  if (error) throw new Error(`listCashAccounts failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    currency: (row.currency as string) ?? "THB",
    currentBalance: nullableNum(row.current_balance as string | null),
    balanceYear: (row.balance_year as number | null) ?? null
  }));
}

/**
 * Transfers are excluded by default: a move between two of your own accounts
 * writes a debit and a credit, so counting both reports the same baht as
 * income and as expense.
 */
export async function monthlySummary(
  year?: number | null,
  includeTransfers = false
): Promise<MonthlySummary[]> {
  const { data, error } = await supabaseAdmin().rpc("cash_monthly_summary", {
    p_year: year ?? null,
    p_include_transfers: includeTransfers
  });

  if (error) throw new Error(`monthlySummary failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    month: row.month as string,
    income: num(row.income as string),
    expense: num(row.expense as string),
    net: num(row.net as string),
    txCount: Number(row.tx_count ?? 0)
  }));
}

export async function categoryTotals(
  year?: number | null,
  includeTransfers = false
): Promise<CategoryTotal[]> {
  const { data, error } = await supabaseAdmin().rpc("cash_category_totals", {
    p_year: year ?? null,
    p_include_transfers: includeTransfers
  });

  if (error) throw new Error(`categoryTotals failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    category: row.category as string,
    income: num(row.income as string),
    expense: num(row.expense as string),
    txCount: Number(row.tx_count ?? 0)
  }));
}

export async function availableYears(): Promise<number[]> {
  const { data, error } = await supabaseAdmin().rpc("cash_years");
  if (error) throw new Error(`availableYears failed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => Number(row.year));
}
