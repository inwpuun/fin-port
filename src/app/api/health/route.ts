import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells you whether the deployment can actually reach Postgres, and says so
 * plainly instead of leaving you to infer it from an empty table.
 *
 * This exists because a bad credential used to be nearly invisible: the data
 * libs swallow errors so pages still render, so a wrong SUPABASE_SECRET_KEY
 * showed up as "the holdings table is empty" rather than "the database
 * rejected us". One curl against this route now answers it.
 *
 * Reports whether each variable is *present*, never its value.
 */

const tables = ["holdings", "allocations", "watchlist", "cash_accounts", "cash_transactions"] as const;

/** PostgREST spreads the useful detail across four fields; keep whatever is set. */
function describeError(error: { message?: string; code?: string; details?: string; hint?: string }) {
  const parts = [error.code, error.message, error.details, error.hint].filter(
    (part) => typeof part === "string" && part.trim() !== ""
  );
  return parts.join(" | ") || "request rejected with no detail";
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const env = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_PUBLISHABLE_KEY: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    ADMIN_TOKEN: Boolean(process.env.ADMIN_TOKEN),
    BOT_API_KEY: Boolean(process.env.BOT_API_KEY)
  };

  // A key pasted with a trailing newline or space is a common and otherwise
  // silent cause of "Invalid API key", so flag it without printing anything.
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("SUPABASE_") && name !== "ADMIN_TOKEN") continue;
    if (value && value !== value.trim()) warnings.push(`${name} has leading or trailing whitespace`);
  }
  if (process.env.SUPABASE_SECRET_KEY?.startsWith("sb_publishable_")) {
    warnings.push("SUPABASE_SECRET_KEY holds a publishable key");
  }

  const counts: Record<string, number | string> = {};
  let reachable = true;
  let firstError: string | null = null;

  for (const table of tables) {
    try {
      // Not head:true -- PostgREST sends no body on a HEAD request, so the
      // error arrives with an empty message and the report says nothing useful.
      const { count, error } = await supabaseAdmin()
        .from(table)
        .select("id", { count: "exact" })
        .limit(1);

      if (error) throw new Error(describeError(error));
      counts[table] = count ?? 0;
    } catch (error) {
      reachable = false;
      const message = error instanceof Error ? error.message : "unknown error";
      counts[table] = `ERROR: ${message}`;
      firstError ??= message;
    }
  }

  return NextResponse.json(
    {
      ok: reachable && warnings.length === 0,
      database: reachable ? "reachable" : "unreachable",
      error: firstError,
      hint: reachable
        ? null
        : "Check SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel -> Settings -> Environment Variables, for this exact environment (Production / Preview). Environment changes need a redeploy to take effect.",
      env,
      warnings,
      counts
    },
    { status: reachable ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
