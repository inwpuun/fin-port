import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { sendPortfolioReport } from "@/lib/portfolio-report";
import { runSignalAlerts, sendLineTest, sendWatchlistDigest } from "@/lib/signal-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One run at a time per process: two overlapping runs would both see a signal as new. */
let running: Promise<unknown> | null = null;

/**
 * Checks the watchlist for CDC ActionZone BUY/SELL and sends new ones to LINE.
 * The built-in scheduler (instrumentation-node.ts) calls this; it can be run
 * by hand too:
 *
 *   POST /api/alerts/signals            check and send
 *   POST /api/alerts/signals?dryRun=1   check only, send nothing, record nothing
 *   POST /api/alerts/signals?dryRun=1&lookback=60   preview signals from the last 60 bars
 *   POST /api/alerts/signals?test=1     send a test message
 *   POST /api/alerts/signals?report=open|close   send the portfolio report now (period=week|month, dryRun=1 to preview)
 *   POST /api/alerts/signals?digest=1   send each symbol's last BUY/SELL (add dryRun=1 to preview)
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const params = request.nextUrl.searchParams;

  try {
    if (params.get("test") === "1") {
      await sendLineTest();
      return NextResponse.json({ ok: true });
    }

    const report = params.get("report");
    if (report === "open" || report === "close") {
      const period = params.get("period");
      return NextResponse.json(
        await sendPortfolioReport(report, {
          dryRun: params.get("dryRun") === "1",
          period: period === "week" || period === "month" ? period : "day"
        })
      );
    }

    if (params.get("digest") === "1") {
      return NextResponse.json(await sendWatchlistDigest({ dryRun: params.get("dryRun") === "1" }));
    }

    if (running) return NextResponse.json({ error: "A check is already running" }, { status: 409 });
    const lookback = Math.min(Math.max(Number(params.get("lookback")) || 2, 1), 500);
    const run = runSignalAlerts({ dryRun: params.get("dryRun") === "1", lookback });
    running = run;
    try {
      return NextResponse.json(await run, { headers: { "cache-control": "no-store" } });
    } finally {
      running = null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("signal alerts failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
