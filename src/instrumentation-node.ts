import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// See instrumentation.ts for why: 250 ms per address is shorter than a cold
// IPv4 handshake from the Pi to Yahoo.
setDefaultAutoSelectFamilyAttemptTimeout(2500);

// --- LINE signal alerts ------------------------------------------------------
//
// Checks the watchlist for CDC ActionZone BUY/SELL every
// SIGNAL_ALERT_INTERVAL_MINUTES (default 30) while the server runs. Off when
// the LINE channel is not configured, or when the interval is set to 0.

declare global {
  var __finPortSignalTimer: NodeJS.Timeout | undefined;
  var __finPortReportTimer: NodeJS.Timeout | undefined;
}

const minutes = Number(process.env.SIGNAL_ALERT_INTERVAL_MINUTES ?? 30);
const configured = Boolean(process.env.LINE_CHANNEL_ID && process.env.LINE_CHANNEL_SECRET);

if (configured && minutes > 0 && !globalThis.__finPortSignalTimer) {
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const { runSignalAlerts } = await import("@/lib/signal-alerts");
      const run = await runSignalAlerts();
      const failed = Object.keys(run.errors);
      console.log(
        `signal alerts: ${run.checked} symbols checked, ${run.signals.length} recent signal(s), ${run.sent.length} sent` +
          (failed.length ? `; failed: ${failed.join(", ")}` : "")
      );
    } catch (error) {
      console.error("signal alerts failed:", error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  };

  // First check a minute after start, once the database is surely up.
  setTimeout(tick, 60_000).unref();
  globalThis.__finPortSignalTimer = setInterval(tick, minutes * 60_000);
  globalThis.__finPortSignalTimer.unref();
  console.log(`signal alerts: checking the watchlist every ${minutes} min`);
}

// --- Portfolio report at the US close ----------------------------------------
//
// Ticks every minute; portfolio-report.ts decides whether a slot is due and
// claims it in the database, so this is cheap and never double-sends.
// PORTFOLIO_REPORT=0 turns it off.

if (configured && process.env.PORTFOLIO_REPORT !== "0" && !globalThis.__finPortReportTimer) {
  let busy = false;

  globalThis.__finPortReportTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { runPortfolioReportIfDue } = await import("@/lib/portfolio-report");
      const result = await runPortfolioReportIfDue();
      if (result) console.log(`portfolio report: ${result.kind} ${result.status}`);
    } catch (error) {
      console.error("portfolio report failed:", error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  }, 60_000);
  globalThis.__finPortReportTimer.unref();
  console.log("portfolio report: US close 16:05 ET, weekdays");
}
