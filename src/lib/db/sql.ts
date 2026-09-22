/**
 * SQL helpers shared by the app, the importers and the CLI scripts.
 *
 * Deliberately NOT `server-only`: scripts/ runs these under tsx, outside
 * Next.js, where importing `server-only` throws. The connection itself lives
 * in ./client.ts, which IS server-only.
 */
import type { QueryResult, QueryResultRow } from "pg";

/**
 * Anything that can run a query: a Pool, a PoolClient held open for a
 * transaction, or the one-shot Client a CLI script opens. Structural on
 * purpose -- `Pool | Client | PoolClient` would force every caller to know
 * which of the three it was handed.
 */
export type Db = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

export type UpsertOptions = {
  /** Columns forming the conflict target, i.e. the table's natural key. */
  conflict: string[];
  /**
   * Columns to overwrite on conflict. Defaults to every non-key column, which
   * is what every caller here wants: re-importing a corrected export should
   * update the row in place.
   */
  update?: string[];
};

/**
 * Builds one multi-row `insert ... on conflict do update`.
 *
 * Postgres caps a statement at 65535 parameters, so callers batch: the widest
 * table here is cash_transactions at 19 columns, which allows ~3400 rows per
 * statement. The importers stay well under that.
 *
 * `updated_at` is left alone on purpose -- the touch_updated_at trigger sets
 * it, and it fires on every conflicting row whether or not a value changed.
 * That is what the "Updated" label in the UI reports: when data was last
 * written, not when a value last differed.
 */
export function buildUpsert(
  table: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  { conflict, update }: UpsertOptions
): { text: string; values: unknown[] } {
  if (!rows.length) throw new Error(`buildUpsert(${table}) called with no rows`);

  const values: unknown[] = [];
  const tuples = dedupe(rows, conflict).map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const overwrite = update ?? columns.filter((column) => !conflict.includes(column));

  const action = overwrite.length
    ? `do update set ${overwrite.map((column) => `${column} = excluded.${column}`).join(", ")}`
    : "do nothing";

  return {
    text:
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")} ` +
      `on conflict (${conflict.join(", ")}) ${action}`,
    values
  };
}

/**
 * Keeps the last row for each conflict key.
 *
 * Postgres rejects an `on conflict do update` whose VALUES name the same key
 * twice -- "cannot affect row a second time" -- so a CSV that lists AAPL on
 * two lines would fail the whole import rather than the second line winning.
 * Last-one-wins is what row-at-a-time upserts did, so do that.
 */
function dedupe(
  rows: Array<Record<string, unknown>>,
  conflict: string[]
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    byKey.set(conflict.map((column) => String(row[column])).join("\u0000"), row);
  }
  return [...byKey.values()];
}

/** Splits a list into fixed-size batches, so one upsert stays under the parameter cap. */
export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Postgres `numeric` arrives as a string: node-postgres refuses to parse it
 * into a float because the type is wider than an IEEE double. Every money
 * column in this schema is numeric, so every read goes through here.
 */
export function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
