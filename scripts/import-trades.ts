/**
 * Trade sheet -> holding_transactions, then holdings rebuilt from the trades.
 *
 *   npm run db:trades -- path/to/fin-port.csv            # import
 *   npm run db:trades -- path/to/fin-port.csv --dry-run  # show the effect, write nothing
 *   npm run db:trades -- "https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=fin-port"
 *
 * The sheet has one trade per row: symbol, side, price, quantity, date, with
 * dates in Thai short form (3/10/69). Every row a previous run imported is
 * replaced, so correcting a row in the sheet and re-running fixes it; trades
 * added through the app are kept. Runs in one transaction, and --dry-run
 * rolls it back after printing what would change.
 */
import { readFile } from "node:fs/promises";
import type { Client } from "pg";
import { importTradeSheet, parseTradeSheet } from "../src/lib/trades";
import { connect, loadEnv } from "./db";

type HoldingRow = { symbol: string; quantity: string; cost_basis: string };

async function readSource(source: string) {
  if (!/^https?:\/\//i.test(source)) return readFile(source, "utf8");

  const response = await fetch(source);
  if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
  return response.text();
}

async function holdings(client: Client) {
  const { rows } = await client.query<HoldingRow>(`select symbol, quantity, cost_basis from holdings`);
  return new Map(rows.map((row) => [row.symbol, row]));
}

function format(row: HoldingRow | undefined) {
  if (!row) return "—".padEnd(28);
  return `${Number(row.quantity).toFixed(7).padStart(14)} ${Number(row.cost_basis).toFixed(2).padStart(12)}`;
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const source = args.find((arg) => !arg.startsWith("--"));

  if (!source) {
    throw new Error("Usage: npm run db:trades -- <file.csv | sheet CSV URL> [--dry-run]");
  }

  const trades = parseTradeSheet(await readSource(source));
  if (!trades.length) throw new Error(`No trades found in ${source}`);
  console.log(`fin-port trades: ${trades.length} rows from ${source}${dryRun ? " (dry run)" : ""}`);

  const client = await connect();

  try {
    await client.query("begin");
    const before = await holdings(client);
    const report = await importTradeSheet(client, trades);
    const after = await holdings(client);

    console.log(`  replaced ${report.removed} previously imported rows with ${report.inserted}\n`);
    console.log(`  ${"symbol".padEnd(8)} ${"qty before".padStart(14)} ${"cost before".padStart(12)}   ->` +
      ` ${"qty after".padStart(14)} ${"cost after".padStart(12)}`);

    for (const { symbol } of report.holdings.sort((first, second) => first.symbol.localeCompare(second.symbol))) {
      console.log(`  ${symbol.padEnd(8)} ${format(before.get(symbol))}   -> ${format(after.get(symbol))}`);
    }

    await client.query(dryRun ? "rollback" : "commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log(dryRun ? "\ndry run: nothing written." : "\ndone.");
}

main().catch((error: unknown) => {
  console.error(`\nimport failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
