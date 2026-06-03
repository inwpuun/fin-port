import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeSymbol } from "@/lib/market";

const myWatchlistPath = path.join(process.cwd(), "public", "my-watchlist.csv");
const fallbackWatchlistSymbols = ["AAPL", "MSFT", "NVDA", "VOO", "BTC-USD", "GC=F"];

export async function getMyWatchlistSymbols(): Promise<string[]> {
  try {
    const csv = await readFile(myWatchlistPath, "utf8");
    const symbols = parseMyWatchlistCsv(csv);
    return symbols.length ? symbols : fallbackWatchlistSymbols;
  } catch {
    return fallbackWatchlistSymbols;
  }
}

export async function upsertMyWatchlistSymbol(symbol: string): Promise<string[]> {
  const current = await getMyWatchlistSymbols();
  const next = upsertWatchlistSymbol(current, symbol);
  await writeFile(myWatchlistPath, serializeMyWatchlistCsv(next), "utf8");
  return next;
}

export async function deleteMyWatchlistSymbol(symbol: string): Promise<string[]> {
  const current = await getMyWatchlistSymbols();
  const next = deleteWatchlistSymbol(current, symbol);
  await writeFile(myWatchlistPath, serializeMyWatchlistCsv(next), "utf8");
  return next;
}

export function upsertWatchlistSymbol(current: string[], symbol: string) {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");
  return uniqueSymbols([normalized, ...current]);
}

export function deleteWatchlistSymbol(current: string[], symbol: string) {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) throw new Error("Symbol is required");
  return current.filter((item) => normalizeWatchlistSymbol(item) !== normalized);
}

export function serializeMyWatchlistCsv(symbols: string[]) {
  const rows = uniqueSymbols(symbols).map(escapeCsvValue);
  return `symbol\n${rows.join("\n")}\n`;
}

function parseMyWatchlistCsv(csv: string) {
  const [headerLine, ...rows] = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!headerLine) return [];

  const headers = splitCsvLine(headerLine).map((value) => value.trim().toLowerCase());
  const symbolIndex = headers.indexOf("symbol");
  const dataRows = symbolIndex >= 0 ? rows : [headerLine, ...rows];

  return uniqueSymbols(
    dataRows.flatMap((row) => {
      const columns = splitCsvLine(row);
      const symbol = columns[symbolIndex >= 0 ? symbolIndex : 0]?.trim();
      return symbol ? [symbol] : [];
    })
  );
}

function uniqueSymbols(symbols: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  symbols.forEach((symbol) => {
    const normalized = normalizeWatchlistSymbol(symbol);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function normalizeWatchlistSymbol(symbol: string) {
  return normalizeSymbol(symbol.trim().toUpperCase());
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

function escapeCsvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}
