import { readdir, readFile } from "fs/promises";
import path from "path";
import type { CashBookTransaction } from "@/types/cash-book";

const cashBookDirectory = path.join(process.cwd(), "public", "cash-book");

type ParsedCashDate = {
  date: string;
  dateLabel: string;
  year: number;
  month: number;
  day: number;
  monthKey: string;
};

export async function getCashBookTransactions() {
  let files: string[];

  try {
    files = await readdir(cashBookDirectory);
  } catch {
    return [];
  }

  const csvFiles = files.filter((file) => file.endsWith(".csv")).sort();
  const parsedFiles = await Promise.all(csvFiles.map((file) => parseCashBookFile(file)));

  return parsedFiles
    .flat()
    .filter((transaction) => transaction.categoryGroup !== "Transfers")
    .sort((first, second) => second.date.localeCompare(first.date) || second.time.localeCompare(first.time));
}

async function parseCashBookFile(file: string) {
  const filePath = path.join(cashBookDirectory, file);
  const sourceYear = Number(file.match(/\d{4}/)?.[0] || 0);
  const rows = parseCsvRows((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  const headerRowIndex = rows.findIndex((row) => row.includes("Name") && row.includes("Amount"));

  if (headerRowIndex < 0) return [];

  const headerIndex = new Map(rows[headerRowIndex].map((header, index) => [cleanText(header), index]));

  return rows
    .slice(headerRowIndex + 1)
    .map((row, index) => parseCashBookRow(row, headerIndex, file, sourceYear, index))
    .filter((transaction): transaction is CashBookTransaction => Boolean(transaction));
}

function parseCashBookRow(
  row: string[],
  headerIndex: Map<string, number>,
  file: string,
  sourceYear: number,
  rowIndex: number
) {
  const rawDate = getField(row, headerIndex, "Date");
  const rawAmount = getField(row, headerIndex, "Amount");
  const amount = parseMoney(rawAmount);

  if (!rawDate || amount === null) return null;

  const parsedDate = parseCashDate(rawDate);
  if (!parsedDate) return null;

  const transferAccount = getField(row, headerIndex, "Transfers");
  const rawCategory = getField(row, headerIndex, "Category");
  const description = getField(row, headerIndex, "Description") || transferDescription(transferAccount, amount);
  const category = normalizeCategory(rawCategory, transferAccount, description);
  const currency = getField(row, headerIndex, "Currency") || "THB";

  return {
    id: `${file}:${rowIndex}`,
    file,
    sourceYear: sourceYear || parsedDate.year,
    account: getField(row, headerIndex, "Account"),
    transferAccount,
    description,
    rawCategory,
    category,
    categoryGroup: normalizeCategoryGroup(category),
    ...parsedDate,
    time: getField(row, headerIndex, "Time"),
    memo: getField(row, headerIndex, "Memo"),
    amount,
    currency,
    tags: getField(row, headerIndex, "Tags"),
    balance: parseMoney(getField(row, headerIndex, "Balance")),
    type: amount >= 0 ? "income" : "expense"
  } satisfies CashBookTransaction;
}

function parseCsvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === "\"") {
      if (quoted && content[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);

  return rows;
}

function getField(row: string[], headerIndex: Map<string, number>, fieldName: string) {
  const index = headerIndex.get(fieldName);
  if (index === undefined) return "";
  return cleanText(row[index] || "");
}

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseMoney(value: string) {
  const normalized = value.replace(/[,+]/g, "").trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCashDate(value: string): ParsedCashDate | null {
  const [dayValue, monthValue, yearValue] = value.split(/[./-]/).map(Number);

  if (!Number.isFinite(dayValue) || !Number.isFinite(monthValue) || !Number.isFinite(yearValue)) return null;

  const year = yearValue > 2400 ? yearValue - 543 : yearValue;
  const day = Math.trunc(dayValue);
  const month = Math.trunc(monthValue);

  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = `${year}-${pad(month)}-${pad(day)}`;

  return {
    date,
    dateLabel: `${pad(day)}/${pad(month)}/${year}`,
    year,
    month,
    day,
    monthKey: `${year}-${pad(month)}`
  };
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
    return rawCategory.replace(/\s*\u25ba\s*/g, " / ");
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
