import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AllocationRule, PortfolioSeed } from "@/types/portfolio";

const myPortPath = path.join(process.cwd(), "public", "my-port.csv");
const myAllocationPath = path.join(process.cwd(), "public", "my-allocation.csv");

export async function getMyPortfolioSeed(): Promise<PortfolioSeed[]> {
  try {
    const csv = await readFile(myPortPath, "utf8");
    return parseMyPortfolioCsv(csv);
  } catch {
    return [];
  }
}

export async function getMyAllocationRules(): Promise<AllocationRule[]> {
  try {
    const csv = await readFile(myAllocationPath, "utf8");
    return parseMyAllocationCsv(csv);
  } catch {
    return [];
  }
}

function parseMyPortfolioCsv(csv: string): PortfolioSeed[] {
  const [headerLine, ...rows] = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!headerLine) return [];

  const headers = splitCsvLine(headerLine).map(normalizeHeader);
  const symbolIndex = headers.indexOf("stock");
  const valueIndex = headers.indexOf("holdingvalue");
  const profitIndex = headers.indexOf("%profit");
  const quantityIndex = headers.indexOf("quantity");
  const costBasisIndex = headers.indexOf("costbasis");
  const costCurrencyIndex = headers.indexOf("costcurrency");

  if (symbolIndex < 0) return [];

  return rows.flatMap((row) => {
    const columns = splitCsvLine(row);
    const symbol = columns[symbolIndex]?.trim().toUpperCase();
    const marketValue = readNumber(columns, valueIndex);
    const profitLossPercent = readNumber(columns, profitIndex);
    const quantity = readNumber(columns, quantityIndex);
    const costBasis = readNumber(columns, costBasisIndex);
    const costCurrency = columns[costCurrencyIndex]?.trim().toUpperCase();

    if (!symbol) {
      return [];
    }

    const hasMarketValueProfit = Number.isFinite(marketValue) && Number.isFinite(profitLossPercent);
    const hasQuantityCost = Number.isFinite(quantity) && Number.isFinite(costBasis);

    if (!hasMarketValueProfit && !hasQuantityCost) return [];

    return {
      id: `my-port-${symbol.replace(/[^A-Z0-9]+/g, "-").toLowerCase()}`,
      symbol,
      ...(hasMarketValueProfit ? { marketValue, profitLossPercent } : {}),
      ...(hasQuantityCost ? { quantity, costBasis, costCurrency: costCurrency || "USD" } : {})
    };
  });
}

function parseMyAllocationCsv(csv: string): AllocationRule[] {
  const [headerLine, ...rows] = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!headerLine) return [];

  const headers = splitCsvLine(headerLine).map(normalizeHeader);
  const categoryIndex = headers.indexOf("category");
  const symbolIndex = headers.indexOf("symbol");
  const cashValueIndex = headers.indexOf("cashvalue");
  const cashCurrencyIndex = headers.indexOf("cashcurrency");

  if (categoryIndex < 0 || symbolIndex < 0) return [];

  return rows.flatMap((row) => {
    const columns = splitCsvLine(row);
    const category = columns[categoryIndex]?.trim();
    const symbol = columns[symbolIndex]?.trim().toUpperCase();
    const cashValue = readNumber(columns, cashValueIndex);
    const cashCurrency = columns[cashCurrencyIndex]?.trim().toUpperCase();

    if (!category || !symbol) return [];

    return {
      category,
      symbol,
      ...(Number.isFinite(cashValue) ? { cashValue } : {}),
      ...(cashCurrency ? { cashCurrency } : {})
    };
  });
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function splitCsvLine(line: string) {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      columns.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  columns.push(current.trim());
  return columns;
}

function readNumber(columns: string[], index: number) {
  if (index < 0) return undefined;
  const value = columns[index]?.trim();
  if (!value) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
