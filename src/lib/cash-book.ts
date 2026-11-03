import "server-only";
import { getCashBook } from "@/lib/cash-book/firefly-book";
import type { CashBookRow } from "@/lib/cash-book/firefly-map";
import type { CashBookTransaction } from "@/types/cash-book";

/**
 * Cash-book reads, straight from Firefly III (held in memory and refreshed in
 * the background, see cash-book/firefly-book.ts). Nothing is stored in
 * Postgres. The exported surface is the one the CSV and Postgres versions
 * had, so cash-book-dashboard.tsx keeps working. Ids are
 * `ff:<journal id>:<src|dst>`, stable for as long as the Firefly row exists.
 */

const CATEGORY_SEPARATOR = "►";

export async function getCashBookTransactions(): Promise<CashBookTransaction[]> {
  let rows: CashBookRow[];

  try {
    rows = (await getCashBook()).rows;
  } catch (error) {
    // Same contract as before: an unreachable source reads as empty so the
    // dashboard renders instead of throwing. Log it, though -- a silent empty
    // ledger is otherwise indistinguishable from a real one.
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

function toCashBookTransaction(row: CashBookRow): CashBookTransaction {
  const amount = row.amount;
  const [year, month, day] = row.date.split("-").map(Number);

  const transferAccount = row.transferAccount ?? "";
  const rawCategory = joinCategory(row.category, row.subcategory);
  const description = row.description.trim() || transferDescription(transferAccount, amount);
  const category = normalizeCategory(rawCategory, transferAccount, description);

  return {
    id: row.id,
    file: "Firefly",
    sourceYear: year,
    account: row.account,
    transferAccount,
    description,
    rawCategory,
    category,
    categoryGroup: normalizeCategoryGroup(category),
    date: row.date,
    dateLabel: `${pad(day)}/${pad(month)}/${year}`,
    monthKey: `${year}-${pad(month)}`,
    year,
    month,
    day,
    // The dashboard sorts and renders on HH:mm, so trim the seconds.
    time: row.time.slice(0, 5),
    memo: row.memo ?? "",
    amount,
    currency: row.currency || "THB",
    tags: row.tags ?? "",
    balance: row.balance,
    type: amount >= 0 ? "income" : "expense"
  };
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
