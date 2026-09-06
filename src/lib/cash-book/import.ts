import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCashBookCsv, type CashAccountInput, type CashTransactionInput } from "./parse";

export type SourceFile = { name: string; content: string };

export type ImportReport = {
  files: Array<{
    name: string;
    transactions: number;
    accounts: number;
    skipped: number;
    collisions: number;
  }>;
  transactionsUpserted: number;
  accountsUpserted: number;
  rowsSkipped: number;
  keyCollisionsResolved: number;
  durationMs: number;
};

/**
 * Postgres has a parameter ceiling per statement, and cash_transactions is 19
 * columns wide, so batch the upsert rather than sending 3k rows at once.
 */
const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Imports one or more cash-book CSV exports in upsert mode.
 *
 * Ids are content hashes (see fingerprintOf), so re-running against the same
 * or an extended export is idempotent: unchanged rows are rewritten with the
 * same values, edited rows update in place, and only genuinely new rows are
 * inserted. Nothing is ever deleted, so re-importing a partial export cannot
 * lose history.
 */
export async function importCashBook(
  client: SupabaseClient,
  sources: SourceFile[]
): Promise<ImportReport> {
  const startedAt = Date.now();

  const report: ImportReport = {
    files: [],
    transactionsUpserted: 0,
    accountsUpserted: 0,
    rowsSkipped: 0,
    keyCollisionsResolved: 0,
    durationMs: 0
  };

  // Deduplicate across files by id: the same transaction can appear in two
  // exports, and a single upsert payload must not name one id twice.
  const transactions = new Map<string, CashTransactionInput>();
  const accounts = new Map<string, CashAccountInput>();

  for (const source of sources) {
    const parsed = parseCashBookCsv(source.content, source.name);

    for (const tx of parsed.transactions) transactions.set(tx.id, tx);
    for (const account of parsed.accounts) {
      // Later exports carry fresher balances; keep the highest year seen.
      const existing = accounts.get(account.name);
      const isNewer = !existing || (account.balance_year ?? 0) >= (existing.balance_year ?? 0);
      if (isNewer) accounts.set(account.name, account);
    }

    report.files.push({
      name: source.name,
      transactions: parsed.transactions.length,
      accounts: parsed.accounts.length,
      skipped: parsed.skipped,
      collisions: parsed.collisions
    });
    report.rowsSkipped += parsed.skipped;
    report.keyCollisionsResolved += parsed.collisions;
  }

  const accountRows = [...accounts.values()];
  if (accountRows.length) {
    const { error } = await client
      .from("cash_accounts")
      .upsert(accountRows, { onConflict: "name" });
    if (error) throw new Error(`cash_accounts upsert failed: ${error.message}`);
    report.accountsUpserted = accountRows.length;
  }

  for (const batch of chunk([...transactions.values()], BATCH_SIZE)) {
    const { error } = await client
      .from("cash_transactions")
      .upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`cash_transactions upsert failed: ${error.message}`);
    report.transactionsUpserted += batch.length;
  }

  report.durationMs = Date.now() - startedAt;
  return report;
}
