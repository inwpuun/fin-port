import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { CashBookTransaction } from "@/types/cash-book";

/**
 * Cash-book reads. The exported surface is unchanged from the CSV version, so
 * cash-book-dashboard.tsx keeps working; only the source moved to Postgres.
 *
 * Rows get there through the importer (npm run db:cash-book, the /cash-book
 * upload form, or POST /api/cash-book/import), which upserts on a content
 * hash. That also means `id` is now stable across imports -- the CSV version
 * used `file:rowIndex`, which shifted whenever a row was inserted upstream.
 */

const CATEGORY_SEPARATOR = "►";

type TransactionRow = {
  id: string;
  account: string;
  transfer_account: string | null;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  occurred_on: string;
  occurred_at: string | null;
  memo: string | null;
  amount: string | number;
  currency: string | null;
  tags: string | null;
  running_balance: string | number | null;
  source_file: string | null;
  source_year: number | null;
};

/** PostgREST caps a default response; page through so no month goes missing. */
const PAGE_SIZE = 1000;

export async function getCashBookTransactions(): Promise<CashBookTransaction[]> {
  const rows: TransactionRow[] = [];

  try {
    for (let page = 0; ; page += 1) {
      const from = page * PAGE_SIZE;

      const { data, error } = await supabaseAdmin()
        .from("cash_transactions")
        .select(
          "id, account, transfer_account, description, category, subcategory, occurred_on, occurred_at, memo, amount, currency, tags, running_balance, source_file, source_year"
        )
        .order("occurred_on", { ascending: false })
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(error.message);

      const batch = (data ?? []) as TransactionRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (error) {
    // Same contract as the CSV version: an unreachable store reads as empty so
    // the dashboard renders instead of throwing. Log it, though -- a silent
    // empty ledger is otherwise indistinguishable from a real one.
    console.error("getCashBookTransactions failed:", error);
    return [];
  }

  return rows
    .map(toCashBookTransaction)
    .filter((transaction) => transaction.categoryGroup !== "Transfers")
    .sort(
      (first, second) =>
        second.date.localeCompare(first.date) || second.time.localeCompare(first.time)
    );
}

function toCashBookTransaction(row: TransactionRow): CashBookTransaction {
  const amount = num(row.amount) ?? 0;
  const [year, month, day] = row.occurred_on.split("-").map(Number);

  const transferAccount = row.transfer_account ?? "";
  const rawCategory = joinCategory(row.category, row.subcategory);
  const description =
    (row.description ?? "").trim() || transferDescription(transferAccount, amount);
  const category = normalizeCategory(rawCategory, transferAccount, description);

  return {
    id: row.id,
    file: row.source_file ?? "",
    sourceYear: row.source_year ?? year,
    account: row.account,
    transferAccount,
    description,
    rawCategory,
    category,
    categoryGroup: normalizeCategoryGroup(category),
    date: row.occurred_on,
    dateLabel: `${pad(day)}/${pad(month)}/${year}`,
    monthKey: `${year}-${pad(month)}`,
    year,
    month,
    day,
    // The dashboard sorts and renders on HH:mm, so trim the stored seconds.
    time: (row.occurred_at ?? "").slice(0, 5),
    memo: row.memo ?? "",
    amount,
    currency: row.currency || "THB",
    tags: row.tags ?? "",
    balance: num(row.running_balance),
    type: amount >= 0 ? "income" : "expense"
  };
}

function num(value: string | number | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rebuilds the exporter's "Parent <sep> Child" string from the split columns. */
function joinCategory(category: string | null, subcategory: string | null) {
  if (!category) return "";
  return subcategory ? `${category} ${CATEGORY_SEPARATOR} ${subcategory}` : category;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function transferDescription(transferAccount: string, amount: number) {
  if (!transferAccount) return "Unlabeled transaction";
  return `Transfer ${amount >= 0 ? "from" : "to"} ${transferAccount}`;
}

function normalizeCategory(rawCategory: string, transferAccount: string, description: string) {
  if (rawCategory) {
    return rawCategory.replace(/\s*►\s*/g, " / ");
  }

  if (transferAccount || /^transfer/i.test(description)) return "Transfers";
  if (/salary|wage/i.test(description)) return "Income";

  return "Uncategorized";
}

function normalizeCategoryGroup(category: string) {
  const root = category.split("/")[0].trim();
  const lowerRoot = root.toLowerCase();

  if (lowerRoot.includes("food")) return "Food";
  if (lowerRoot.includes("transport")) return "Transport";
  if (lowerRoot.includes("shopping")) return "Shopping";
  if (lowerRoot.includes("personal")) return "Personal";
  if (lowerRoot.includes("health")) return "Health";
  if (lowerRoot.includes("household")) return "Household";
  if (lowerRoot.includes("salary") || lowerRoot.includes("wage") || lowerRoot === "income") return "Income";
  if (lowerRoot.includes("transfer")) return "Transfers";

  return root || "Uncategorized";
}
