import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { query, queryOne } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells you whether the deployment can actually reach Postgres, and says so
 * plainly instead of leaving you to infer it from an empty table.
 *
 * This exists because a bad connection string used to be nearly invisible: the
 * data libs swallow errors so pages still render, so a wrong DATABASE_URL
 * showed up as "the holdings table is empty" rather than "the database refused
 * us". One curl against this route now answers it.
 *
 * Reports whether each variable is *present*, never its value -- DATABASE_URL
 * carries a password.
 */

const tables = [
  "holdings",
  "allocations",
  "watchlist",
  "cash_accounts",
  "cash_transactions"
] as const;

function describeError(error: unknown) {
  if (!(error instanceof Error)) return "request rejected with no detail";

  // node-postgres hangs the Postgres SQLSTATE and detail off the error, and
  // they are the useful part: 28P01 is a bad password, 3D000 a missing
  // database, 42P01 a table that migrations never created.
  const pgError = error as Error & { code?: string; detail?: string; hint?: string };
  const parts = [pgError.code, pgError.message, pgError.detail, pgError.hint].filter(
    (part): part is string => typeof part === "string" && part.trim() !== ""
  );

  return parts.join(" | ") || "request rejected with no detail";
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const env = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    ADMIN_TOKEN: Boolean(process.env.ADMIN_TOKEN),
    BOT_API_KEY: Boolean(process.env.BOT_API_KEY)
  };

  // A value pasted with a trailing newline or space is a common and otherwise
  // silent cause of a failed connection, so flag it without printing anything.
  const warnings: string[] = [];
  for (const name of ["DATABASE_URL", "ADMIN_TOKEN", "BOT_API_KEY"]) {
    const value = process.env[name];
    if (value && value !== value.trim()) warnings.push(`${name} has leading or trailing whitespace`);
  }

  const counts: Record<string, number | string> = {};
  let reachable = true;
  let firstError: string | null = null;
  let version: string | null = null;

  try {
    const row = await queryOne<{ version: string }>(
      `select current_setting('server_version') as version`
    );
    version = row?.version ?? null;
  } catch (error) {
    reachable = false;
    firstError = describeError(error);
  }

  if (reachable) {
    for (const table of tables) {
      try {
        const row = await queryOne<{ count: string }>(`select count(*)::text as count from ${table}`);
        counts[table] = Number(row?.count ?? 0);
      } catch (error) {
        // A missing table is a migration problem, not a connection problem, so
        // keep going: the report should name every table that is absent.
        reachable = false;
        const detail = describeError(error);
        counts[table] = `ERROR: ${detail}`;
        firstError ??= detail;
      }
    }
  } else {
    for (const table of tables) counts[table] = "ERROR: no connection";
  }

  // Confirm the migration ledger too. A database that answers but has never
  // been migrated is the one failure the table counts alone cannot explain.
  let migrations: string[] | string = [];
  try {
    const rows = await query<{ version: string }>(
      `select version from schema_migrations order by version`
    );
    migrations = rows.map((row) => row.version);
  } catch {
    migrations = "none applied -- run npm run db:migrate";
  }

  return NextResponse.json(
    {
      ok: reachable && warnings.length === 0,
      database: reachable ? "reachable" : "unreachable",
      version,
      error: firstError,
      hint: reachable
        ? null
        : "Check DATABASE_URL. Under Docker Compose the host must be `db`, not localhost; running npm run dev on your machine it is 127.0.0.1:5432. If the connection works but tables are missing, run npm run db:migrate.",
      env,
      warnings,
      migrations,
      counts
    },
    { status: reachable ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
