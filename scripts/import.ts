/**
 * CSV -> Postgres importer.
 *
 *   npm run db:seed          # holdings, allocations, watchlist from data/*.csv
 *   npm run db:cash-book     # every data/cash-book/report-*.csv
 *   npm run db:import        # both
 *   npx tsx scripts/import.ts cash-book path/to/other-export.csv
 *
 * Everything runs in upsert mode, so re-running is safe and never duplicates.
 * This connects with DATABASE_URL and is meant to be run from a trusted
 * machine or CI -- never from a browser.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { importCashBook } from "../src/lib/cash-book/import";
import { importAllocations, importHoldings, importWatchlist } from "../src/lib/seed";
import { connect, loadEnv, projectRoot } from "./db";

const dataDir = path.join(projectRoot, "data");

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function seed(client: Client) {
  const jobs: Array<[string, (csv: string) => Promise<{ table: string; rows: number }>]> = [
    ["my-port.csv", (csv) => importHoldings(client, csv)],
    ["my-allocation.csv", (csv) => importAllocations(client, csv)],
    ["my-watchlist.csv", (csv) => importWatchlist(client, csv)]
  ];

  for (const [name, run] of jobs) {
    const csv = await readIfPresent(path.join(dataDir, name));
    if (csv === null) {
      console.warn(`  skip  data/${name} (not found)`);
      continue;
    }
    const result = await run(csv);
    console.log(`  ok    ${result.table.padEnd(12)} ${result.rows} rows upserted from data/${name}`);
  }
}

async function cashBook(client: Client, explicit: string[]) {
  let files = explicit;

  if (!files.length) {
    const dir = path.join(dataDir, "cash-book");
    const entries = await readdir(dir).catch(() => [] as string[]);
    files = entries
      .filter((entry) => entry.toLowerCase().endsWith(".csv"))
      .sort()
      .map((entry) => path.join(dir, entry));
  }

  if (!files.length) {
    console.warn("  skip  no cash-book CSVs found in data/cash-book");
    return;
  }

  const sources = await Promise.all(
    files.map(async (file) => ({
      name: path.basename(file),
      content: await readFile(file, "utf8")
    }))
  );

  const report = await importCashBook(client, sources);

  for (const file of report.files) {
    console.log(
      `  read  ${file.name.padEnd(20)} ${String(file.transactions).padStart(5)} tx  ` +
        `${file.accounts} accounts  ${file.skipped} skipped  ${file.collisions} key collisions`
    );
  }
  console.log(
    `  ok    cash_transactions ${report.transactionsUpserted} rows upserted, ` +
      `cash_accounts ${report.accountsUpserted} rows, in ${report.durationMs} ms`
  );
  if (report.keyCollisionsResolved) {
    console.log(
      `  note  ${report.keyCollisionsResolved} rows shared a natural key and were kept apart by occurrence index.`
    );
  }
}

async function main() {
  loadEnv();

  const [command = "all", ...rest] = process.argv.slice(2);

  if (!["seed", "cash-book", "all"].includes(command)) {
    throw new Error(`Unknown command "${command}". Use: seed | cash-book | all`);
  }

  console.log(`fin-port import: ${command}`);

  const client = await connect();

  try {
    // One transaction per run. A CSV that fails validation halfway through
    // should leave the tables as they were, not partly rewritten.
    await client.query("begin");

    if (command === "seed" || command === "all") await seed(client);
    if (command === "cash-book" || command === "all") await cashBook(client, rest);

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log("done.");
}

main().catch((error: unknown) => {
  console.error(`\nimport failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
