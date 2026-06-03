import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeSymbol } from "@/lib/market";
import type { AllocationRule, PortfolioSeed } from "@/types/portfolio";

const myPortPath = path.join(process.cwd(), "public", "my-port.csv");
const myAllocationPath = path.join(process.cwd(), "public", "my-allocation.csv");
const myPortfolioCsvHeader = ["stock", "quantity", "cost basis", "cost currency"];

type PortfolioHoldingValueInput = {
  stock: string;
  holdingValue: number;
  profitPercent: number;
  marketPrice: number;
};

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

export function createPortfolioSeedFromHoldingValue({
  stock,
  holdingValue,
  profitPercent,
  marketPrice
}: PortfolioHoldingValueInput): PortfolioSeed {
  const symbol = stock.trim().toUpperCase();
  const profitRatio = 1 + profitPercent / 100;

  if (!symbol) throw new Error("Stock is required");
  if (!Number.isFinite(holdingValue) || holdingValue <= 0) throw new Error("Holding value must be greater than zero");
  if (!Number.isFinite(profitPercent) || profitRatio <= 0) throw new Error("% profit must be greater than -100");
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) throw new Error("Market price must be greater than zero");

  return normalizePortfolioSeedForCsv({
    id: createPortfolioSeedId(symbol),
    symbol,
    quantity: holdingValue / marketPrice,
    costBasis: holdingValue / profitRatio,
    costCurrency: "USD"
  });
}

export async function upsertMyPortfolioSeed(seed: PortfolioSeed): Promise<PortfolioSeed[]> {
  const current = await getMyPortfolioSeed();
  const next = upsertPortfolioSeeds(current, normalizePortfolioSeedForCsv(seed));
  await writeFile(myPortPath, serializeMyPortfolioCsv(next), "utf8");
  return next;
}

export async function deleteMyPortfolioSeed(stock: string): Promise<PortfolioSeed[]> {
  const current = await getMyPortfolioSeed();
  const next = deletePortfolioSeed(current, stock);
  await writeFile(myPortPath, serializeMyPortfolioCsv(next), "utf8");
  return next;
}

export function upsertPortfolioSeeds(current: PortfolioSeed[], seed: PortfolioSeed) {
  const seedKey = portfolioSymbolKey(seed.symbol);
  const existingIndex = current.findIndex((item) => portfolioSymbolKey(item.symbol) === seedKey);

  if (existingIndex < 0) {
    return [...current, seed];
  }

  return current.map((item, index) => (index === existingIndex ? seed : item));
}

export function deletePortfolioSeed(current: PortfolioSeed[], stock: string) {
  const stockKey = portfolioSymbolKey(stock);
  return current.filter((item) => portfolioSymbolKey(item.symbol) !== stockKey);
}

export function serializeMyPortfolioCsv(seeds: PortfolioSeed[]) {
  const rows = seeds.map((seed) => {
    const normalized = normalizePortfolioSeedForCsv(seed);

    return [
      normalized.symbol,
      formatCsvNumber(normalized.quantity!, 8),
      formatCsvNumber(normalized.costBasis!, 2),
      normalized.costCurrency || "USD"
    ]
      .map(escapeCsvValue)
      .join(",");
  });

  return `${myPortfolioCsvHeader.join(",")}\n${rows.join("\n")}\n`;
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
      id: createPortfolioSeedId(symbol),
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

function normalizePortfolioSeedForCsv(seed: PortfolioSeed): PortfolioSeed {
  const symbol = seed.symbol.trim().toUpperCase();
  const quantity = Number(seed.quantity);
  const costBasis = Number(seed.costBasis);
  const costCurrency = (seed.costCurrency || "USD").trim().toUpperCase();

  if (!symbol) throw new Error("Stock is required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${symbol} quantity must be greater than zero`);
  if (!Number.isFinite(costBasis) || costBasis <= 0) throw new Error(`${symbol} cost basis must be greater than zero`);

  return {
    id: seed.id || createPortfolioSeedId(symbol),
    symbol,
    quantity: roundTo(quantity, 8),
    costBasis: roundTo(costBasis, 2),
    costCurrency: costCurrency || "USD"
  };
}

function createPortfolioSeedId(symbol: string) {
  const key = symbol.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `my-port-${key || "stock"}`;
}

function portfolioSymbolKey(symbol: string) {
  return normalizeSymbol(symbol);
}

function roundTo(value: number, decimalPlaces: number) {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCsvNumber(value: number, decimalPlaces: number) {
  return value.toFixed(decimalPlaces).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function escapeCsvValue(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}
