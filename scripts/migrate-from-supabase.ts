/**
 * One-shot data migration: Supabase -> the Postgres in docker-compose.yml.
 *
 *   npm run db:migrate                    # create the schema first
 *   npm run db:from-supabase              # then copy every table across
 *   npm run db:from-supabase -- --dry-run # count rows, write nothing
 *   npm run db:from-supabase -- holdings watchlist
 *
 * Reads over Supabase's REST API with the secret key, so it needs no Supabase
 * SDK and no database password for the old project -- just the two values the
 * app used to run on:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_SECRET_KEY=sb_secret_...
 *
 * Keep them in .env.local alongside DATABASE_URL until this has run, then
 * delete them. Everything is upserted on each table's natural key, so an
 * interrupted run can simply be repeated: rows already copied are rewritten
 * with the same values rather than duplicated.
 *
 * created_at and updated_at come across verbatim on insert, so the "Updated"
 * label in the UI keeps telling the truth about when data was last written.
 * (The touch_updated_at trigger only fires on UPDATE, so a re-run of an
 * already-copied row does move its updated_at -- expected, and harmless.)
 */
import { connect, loadEnv } from "./db";

/**
 * Copy order matters: alert_events references alert_rules, so the parent has
 * to land first. Everything else is independent.
 */
const TABLES: Array<{ name: string; conflict: string[] }> = [
  { name: "holdings", conflict: ["symbol"] },
  { name: "allocations", conflict: ["category", "symbol"] },
  { name: "watchlist", conflict: ["symbol"] },
  { name: "cash_accounts", conflict: ["name"] },
  { name: "cash_transactions", conflict: ["id"] },
  { name: "fx_rates", conflict: ["base", "quote", "as_of"] },
  { name: "portfolio_snapshots", conflict: ["as_of"] },
  { name: "holding_transactions", conflict: ["id"] },
  { name: "alert_rules", conflict: ["symbol", "kind"] },
  { name: "alert_events", conflict: ["id"] }
];

/** PostgREST caps a response, so read in pages and keep the order stable. */
const PAGE_SIZE = 1000;

/** One insert per batch. Each row is a single jsonb parameter, so this is only about memory. */
const WRITE_BATCH = 500;

type Row = Record<string, unknown>;

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set to read the old project. " +
        "Put them back in .env.local for this one run, then remove them. " +
        "If you have no Supabase data to move, skip this script and use: npm run db:import"
    );
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SECRET_KEY holds a publishable key. RLS denies it everything, so it would " +
        "read zero rows and report a successful migration of nothing. Use the sb_secret_... key."
    );
  }

  return { url, key };
}

/**
 * Reads one table out of PostgREST, a page at a time.
 *
 * Ordered by the primary key so the pages cannot overlap or skip: an unordered
 * offset scan is free to return the same row twice across two requests.
 */
async function fetchTable(table: string, orderBy: string): Promise<Row[] | null> {
  const { url, key } = supabaseConfig();
  const rows: Row[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint =
      `${url}/rest/v1/${table}` +
      `?select=*&order=${encodeURIComponent(orderBy)}&limit=${PAGE_SIZE}&offset=${offset}`;

    let response: Response;

    try {
      response = await fetch(endpoint, {
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          accept: "application/json"
        }
      });
    } catch (error) {
      // `fetch failed` on its own tells you nothing. The cause almost always
      // does, and the two that actually happen here have very different fixes.
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;

      if (cause?.code === "ENOTFOUND") {
        throw new Error(
          `${new URL(url).hostname} does not resolve. A deleted Supabase project stops ` +
            `resolving entirely, so check SUPABASE_URL against the dashboard -- and if the ` +
            `project really is gone, there is nothing left to copy: seed from the CSVs ` +
            `instead with npm run db:import.`
        );
      }

      throw new Error(
        `Could not reach ${new URL(url).hostname}: ${cause?.code ?? ""} ${cause?.message ?? (error as Error).message}`.trim() +
          ". On the office network, source ~/export_proxy.sh first."
      );
    }

    if (response.status === 404) return null; // table never existed over there
    if (!response.ok) {
      throw new Error(`${table}: Supabase returned ${response.status} ${await response.text()}`);
    }

    const page = (await response.json()) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Column names of the local table, so a column Supabase has and we do not is dropped rather than fatal. */
async function localColumns(
  client: Awaited<ReturnType<typeof connect>>,
  table: string
): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table]
  );
  return rows.map((row) => row.column_name);
}

/**
 * Writes a batch with jsonb_populate_recordset.
 *
 * The whole batch travels as ONE json parameter and Postgres casts each field
 * to the column's real type. That matters more than it looks: a jsonb column
 * bound as a normal parameter would be mangled (node-postgres turns a JS array
 * into a Postgres array literal, not json), and dates and numerics would have
 * to be reformatted by hand. This way the database does all the coercion, from
 * the same JSON the REST API produced.
 */
async function writeBatch(
  client: Awaited<ReturnType<typeof connect>>,
  table: string,
  conflict: string[],
  columns: string[],
  rows: Row[]
) {
  // Never overwrite the surrogate key on a re-run: a row that already exists
  // locally keeps its own id, and rewriting it would break anything already
  // pointing at it (alert_events.rule_id, for one).
  const overwrite = columns.filter(
    (column) => column !== "id" && !conflict.includes(column)
  );

  const action = overwrite.length
    ? `do update set ${overwrite.map((column) => `${column} = excluded.${column}`).join(", ")}`
    : "do nothing";

  const sql =
    `insert into public.${table} (${columns.join(", ")}) ` +
    `select ${columns.join(", ")} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) ` +
    `on conflict (${conflict.join(", ")}) ${action}`;

  await client.query(sql, [JSON.stringify(rows)]);
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = new Set(args.filter((arg) => !arg.startsWith("--")));

  const selected = only.size ? TABLES.filter((table) => only.has(table.name)) : TABLES;

  if (!selected.length) {
    throw new Error(
      `No known table matched. Available: ${TABLES.map((table) => table.name).join(", ")}`
    );
  }

  console.log(`fin-port: Supabase -> Postgres${dryRun ? " (dry run, nothing is written)" : ""}\n`);

  const client = await connect();
  let copied = 0;

  try {
    for (const { name, conflict } of selected) {
      const columns = await localColumns(client, name);
      if (!columns.length) {
        console.warn(`  skip   ${name.padEnd(21)} not in the local schema -- run npm run db:migrate first`);
        continue;
      }

      const source = await fetchTable(name, conflict.join(","));
      if (source === null) {
        console.warn(`  skip   ${name.padEnd(21)} not present in Supabase`);
        continue;
      }
      if (!source.length) {
        console.log(`  empty  ${name.padEnd(21)} 0 rows`);
        continue;
      }

      // Drop any column the old project had and this schema does not, rather
      // than failing the whole table on one stray field.
      const shared = columns.filter((column) => column in source[0]);
      const dropped = Object.keys(source[0]).filter((column) => !columns.includes(column));

      if (dryRun) {
        console.log(`  would  ${name.padEnd(21)} ${String(source.length).padStart(6)} rows`);
        copied += source.length;
        continue;
      }

      const startedAt = Date.now();
      await client.query("begin");

      try {
        for (let index = 0; index < source.length; index += WRITE_BATCH) {
          await writeBatch(client, name, conflict, shared, source.slice(index, index + WRITE_BATCH));
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw new Error(`${name}: ${error instanceof Error ? error.message : error}`);
      }

      const { rows: after } = await client.query<{ count: string }>(
        `select count(*)::text as count from public.${name}`
      );

      console.log(
        `  ok     ${name.padEnd(21)} ${String(source.length).padStart(6)} rows read, ` +
          `${after[0].count} now in the table (${Date.now() - startedAt} ms)` +
          (dropped.length ? `  [ignored columns: ${dropped.join(", ")}]` : "")
      );
      copied += source.length;
    }
  } finally {
    await client.end();
  }

  console.log(
    dryRun
      ? `\n${copied} rows would be copied. Re-run without --dry-run to do it.`
      : `\n${copied} rows copied. Check it with: curl -H "authorization: Bearer $ADMIN_TOKEN" localhost:3000/api/health`
  );
}

main().catch((error: unknown) => {
  console.error(`\nmigration failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
