/**
 * Rebuilds THB cash (the CASH rows in the trade log) from the cash book in
 * Firefly III -- what the app does on its own whenever the book changes.
 *
 *   npm run cash:rebuild
 *
 * Needs DATABASE_URL, FIREFLY_URL and FIREFLY_TOKEN.
 */
import { mapFirefly } from "../src/lib/cash-book/firefly-map";
import { describeCashSync, syncCashFromBook } from "../src/lib/cash-book/sync-cash";
import { fetchAssetAccounts, fetchSplits, fireflyConfig } from "../src/lib/firefly";
import { connect, loadEnv } from "./db";

async function main() {
  loadEnv();
  const config = fireflyConfig();
  if (!config) throw new Error("Set FIREFLY_URL and FIREFLY_TOKEN (see .env.example).");

  const [accounts, splits] = await Promise.all([fetchAssetAccounts(config), fetchSplits(config)]);
  const book = mapFirefly(accounts, splits);
  console.log(`  read  ${book.rows.length} rows, ${book.accounts.length} accounts from Firefly`);

  const client = await connect();
  try {
    await client.query("begin");
    console.log(`  ${describeCashSync(await syncCashFromBook(client, book))}`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\nrebuild failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
