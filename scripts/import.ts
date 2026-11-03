/**
 * CSV -> Postgres importer.
 *
 *   npm run db:seed          # holdings, allocations, watchlist from data/*.csv
 *   npm run db:import        # the same
 *
 * The cash book is no longer a CSV import: the app reads it from Firefly III.
 *
 * Everything runs in upsert mode, so re-running is safe and never duplicates.
 * This connects with DATABASE_URL and is meant to be run from a trusted
 * machine or CI -- never from a browser.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
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

async function main() {
  loadEnv();

  const [command = "all"] = process.argv.slice(2);

  if (command === "cash-book") {
    throw new Error("The cash book is read from Firefly III now; there is nothing to import.");
  }
  if (!["seed", "all"].includes(command)) {
    throw new Error(`Unknown command "${command}". Use: seed | all`);
  }

  console.log(`fin-port import: ${command}`);

  const client = await connect();

  try {
    // One transaction per run. A CSV that fails validation halfway through
    // should leave the tables as they were, not partly rewritten.
    await client.query("begin");

    await seed(client);

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
