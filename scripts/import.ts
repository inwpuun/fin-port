/**
 * CSV -> Supabase importer.
 *
 *   npm run db:seed          # holdings, allocations, watchlist from data/*.csv
 *   npm run db:cash-book     # every data/cash-book/report-*.csv
 *   npm run db:import        # both
 *   npx tsx scripts/import.ts cash-book path/to/other-export.csv
 *
 * Everything runs in upsert mode, so re-running is safe and never duplicates.
 * This talks to Supabase directly with the secret key and is meant to be run
 * from a trusted machine or CI -- never from a browser.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { importCashBook } from "../src/lib/cash-book/import";
import { importAllocations, importHoldings, importWatchlist } from "../src/lib/seed";

const projectRoot = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(projectRoot, "data");

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(projectRoot, file));
    } catch {
      // Missing file is fine; the variable may come from the shell or CI.
    }
  }
}

function makeClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url) throw new Error("SUPABASE_URL is not set (check .env.local).");
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Create one in Supabase -> Project Settings -> API Keys -> Secret keys, then add it to .env.local. The publishable key cannot write: RLS denies it by design."
    );
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY holds a publishable key. Use the sb_secret_... key.");
  }

  return createClient(url.replace(/\/+$/, ""), key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function seed(client: ReturnType<typeof makeClient>) {
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

async function cashBook(client: ReturnType<typeof makeClient>, explicit: string[]) {
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
  const client = makeClient();

  console.log(`fin-port import: ${command}`);

  if (command === "seed" || command === "all") await seed(client);
  if (command === "cash-book" || command === "all") await cashBook(client, rest);

  if (!["seed", "cash-book", "all"].includes(command)) {
    throw new Error(`Unknown command "${command}". Use: seed | cash-book | all`);
  }

  console.log("done.");
}

main().catch((error: unknown) => {
  console.error(`\nimport failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
