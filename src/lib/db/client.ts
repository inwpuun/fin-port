import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseUrl } from "@/lib/env";

/**
 * The one connection pool for the whole app.
 *
 * Cached on globalThis because Next.js reloads server modules on every edit in
 * dev: a module-level `new Pool()` would leak a pool per hot reload until
 * Postgres refuses further connections. Production loads the module once, so
 * the global is a no-op there.
 */

declare global {
  var __finPortPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__finPortPool) {
    globalThis.__finPortPool = new Pool({
      connectionString: databaseUrl(),
      // Small on purpose. This is a single-user dashboard beside its own
      // Postgres; the default of 10 per process is already more concurrency
      // than any page here generates.
      max: 5,
      idleTimeoutMillis: 30_000,
      // Fail fast instead of hanging a page render for the default 0 (never).
      // The data libs catch the error and render an empty table, which is a
      // far better outcome than a request that never returns.
      connectionTimeoutMillis: 5_000
    });

    // An idle client dropped by the server (restart, timeout) emits 'error' on
    // the pool. Without a listener Node treats it as unhandled and kills the
    // process, taking the whole site down because one spare socket closed.
    globalThis.__finPortPool.on("error", (error) => {
      console.error("postgres pool error:", error.message);
    });
  }

  return globalThis.__finPortPool;
}

/** Runs a parameterized query and returns just the rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await pool().query<T>(text, values);
  return result.rows;
}

/** First row, or null. For the many lookups here that expect at most one. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/**
 * Runs `work` inside a transaction on a single checked-out connection.
 *
 * The importers need this: a cash-book import writes accounts and several
 * batches of transactions, and a failure halfway through should leave the
 * ledger as it was rather than half-updated.
 */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();

  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {
      // The rollback can only fail if the connection is already gone, in which
      // case the transaction is aborted anyway. Report the original error.
    });
    throw error;
  } finally {
    client.release();
  }
}

/** Exposed for the health route, which needs the pool itself to probe it. */
export function db(): Pool {
  return pool();
}
