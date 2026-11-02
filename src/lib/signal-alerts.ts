import "server-only";
import { query } from "@/lib/db/client";
import { lineConfig } from "@/lib/env";
import { percentFormat } from "@/lib/format";
import { cdcActionZone, chartSeries, regressionAt, regressionTrend } from "@/lib/indicators";
import { sendLineText } from "@/lib/line";
import { fetchMarketData } from "@/lib/market";
import { getMyWatchlistSymbols } from "@/lib/my-watchlist";
import { lastSignalText, mapLimited, money, readCdc, thaiDate, timeAgo, zoneStatus } from "@/lib/signal-format";
import type { MarketData, MarketRange } from "@/types/market";

/**
 * LINE alerts for the Summary lens's buy/sell marks on watchlist symbols.
 *
 * The trigger is CDC ActionZone's BUY/SELL, computed exactly as the chart
 * computes it (same bars, warm-up included). The regression trend rides along
 * as context: where price sits against the fitted line, in standard
 * deviations, on the same range the Summary chart opens with.
 *
 * Only the last RECENT_BARS bars are looked at, so the first run after a
 * deploy does not replay a year of history, and a signal printed on a bar
 * that closed between two checks is still caught. A signal on today's bar can
 * still disappear before the close, as it can on the chart.
 */

const RANGE: MarketRange = "1y";
const RECENT_BARS = 2;
const CONCURRENCY = 4;

export type FoundSignal = {
  symbol: string;
  name: string;
  type: "buy" | "sell";
  time: string;
  price: number;
  text: string;
};

export type SignalRun = {
  checked: number;
  signals: FoundSignal[];
  sent: FoundSignal[];
  errors: Record<string, string>;
  delivered: boolean;
  dryRun: boolean;
};

function describe(data: MarketData, lookback: number): FoundSignal[] {
  const { candles } = chartSeries(data);
  const cdc = cdcActionZone(candles);
  const recentFrom = candles.length - lookback;

  const trend = regressionTrend(data.candles);
  const lastWindowIndex = data.candles.length - 1;
  const last = data.candles[lastWindowIndex];
  const sigmaAway =
    trend && trend.sigma > 0 && last ? (last.close - regressionAt(trend, lastWindowIndex)) / trend.sigma : null;

  return cdc.signals
    .filter((signal) => signal.index >= recentFrom)
    .map((signal) => {
      const bar = candles[signal.index];
      const zone = cdc.zones.at(-1);
      const buy = signal.type === "buy";
      const lines = [
        `${buy ? "🟢 BUY" : "🔴 SELL"} · ${data.symbol}${data.name && data.name !== data.symbol ? ` (${data.name})` : ""}`,
        `CDC ActionZone ${buy ? "สัญญาณซื้อ" : "สัญญาณขาย"} ${thaiDate(bar.time)} (${timeAgo(bar.time)})`,
        `ราคาปิด ${money(bar.close, data.currency)} · วันนี้ ${percentFormat(data.changePercent)}`,
        `ล่าสุด EMA12 ${cdc.fast.at(-1)!.toFixed(2)} / EMA26 ${cdc.slow.at(-1)!.toFixed(2)}`
      ];
      if (zone) lines.push(`สถานะ: ${zoneStatus[zone]}`);
      if (trend && sigmaAway !== null) {
        lines.push(
          `Regression ${data.rangeLabel} (${trend.direction === "high-to-low" ? "high→low" : "low→high"}, R ${trend.pearsonR.toFixed(2)}): ราคาอยู่ ${sigmaAway >= 0 ? "+" : ""}${sigmaAway.toFixed(1)}σ จากเส้น`
        );
      }
      return { symbol: data.symbol, name: data.name, type: signal.type, time: bar.time, price: bar.close, text: lines.join("\n") };
    });
}

/** Finds new signals on the watchlist and, unless `dryRun`, sends them to LINE in one message. */
export async function runSignalAlerts({ dryRun = false, lookback = RECENT_BARS } = {}): Promise<SignalRun> {
  // A longer look back is a preview only: sending it would replay old signals.
  if (lookback !== RECENT_BARS) dryRun = true;
  const config = lineConfig();
  if (!config && !dryRun) throw new Error("LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are not set");

  const symbols = await getMyWatchlistSymbols();
  const errors: Record<string, string> = {};
  const signals: FoundSignal[] = [];

  // A failed fetch skips the symbol. The offline demo series is never used
  // here: an alert computed from made-up prices is worse than no alert.
  const results = await mapLimited(symbols, CONCURRENCY, (symbol) => fetchMarketData(symbol, RANGE, "1d", "1y", true));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") signals.push(...describe(result.value, lookback));
    else errors[symbols[index]] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });

  const sentRows = signals.length
    ? await query<{ symbol: string; bar_date: string; signal: string }>(
        `select symbol, to_char(bar_date, 'YYYY-MM-DD') as bar_date, signal
           from signal_notifications
          where symbol = any($1::text[])`,
        [[...new Set(signals.map((signal) => signal.symbol))]]
      )
    : [];
  const already = new Set(sentRows.map((row) => `${row.symbol}|${row.bar_date}|${row.signal}`));
  const fresh = signals.filter((signal) => !already.has(`${signal.symbol}|${signal.time}|${signal.type}`));

  if (dryRun || !fresh.length || !config) {
    return { checked: symbols.length, signals, sent: [], errors, delivered: false, dryRun };
  }

  // One request, up to five bubbles, so a busy day costs one message of quota.
  const bubbles: string[] = [];
  for (const signal of fresh) {
    const last = bubbles.at(-1);
    if (last !== undefined && last.length + signal.text.length + 2 <= 4800) bubbles[bubbles.length - 1] = `${last}\n\n${signal.text}`;
    else bubbles.push(signal.text);
  }
  await sendLineText(config, bubbles);

  // Recorded only after LINE accepted it, so a failed send is retried next run.
  await query(
    `insert into signal_notifications (symbol, bar_date, signal, price, message)
     select * from unnest($1::text[], $2::date[], $3::text[], $4::numeric[], $5::text[])
     on conflict do nothing`,
    [
      fresh.map((signal) => signal.symbol),
      fresh.map((signal) => signal.time),
      fresh.map((signal) => signal.type),
      fresh.map((signal) => signal.price),
      fresh.map((signal) => signal.text)
    ]
  );

  return { checked: symbols.length, signals, sent: fresh, errors, delivered: true, dryRun };
}

/**
 * The last CDC BUY or SELL each watchlist symbol has passed, and its status
 * now, as one LINE message. Sent on demand; it records nothing, so it never
 * stops the scheduler from reporting a new signal.
 */
export async function sendWatchlistDigest({ dryRun = false } = {}) {
  const config = lineConfig();
  if (!config && !dryRun) throw new Error("LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are not set");

  const symbols = await getMyWatchlistSymbols();
  const errors: Record<string, string> = {};
  const rows: Array<{ data: MarketData; read: ReturnType<typeof readCdc> }> = [];

  const results = await mapLimited(symbols, CONCURRENCY, (symbol) => fetchMarketData(symbol, RANGE, "1d", "1y", true));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") rows.push({ data: result.value, read: readCdc(result.value) });
    else errors[symbols[index]] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });

  // Freshest signal first, buys before sells on the same day.
  rows.sort(
    (a, b) =>
      (b.read.last?.time ?? "").localeCompare(a.read.last?.time ?? "") ||
      (a.read.last?.type === b.read.last?.type ? 0 : a.read.last?.type === "buy" ? -1 : 1)
  );

  const block = ({ data, read }: (typeof rows)[number]) => {
    const head = read.last ? `${read.last.type === "buy" ? "🟢" : "🔴"} ${data.symbol}` : `⚪ ${data.symbol}`;
    const lines = [head, `   ${lastSignalText(read)}${read.last ? ` @ ${money(read.last.price, data.currency)}` : ""}`];
    const since = read.last ? ` (${percentFormat(((data.price - read.last.price) / read.last.price) * 100)})` : "";
    lines.push(`   ตอนนี้ ${money(data.price, data.currency)}${since}`, `   สถานะ: ${read.status}`);
    return lines.join("\n");
  };

  const failed = Object.keys(errors);
  const text = [
    `📊 fin-port · สัญญาณ CDC ล่าสุดของ watchlist (${rows.length} ตัว)`,
    ...rows.map(block),
    ...(failed.length ? [`ดึงราคาไม่ได้: ${failed.join(", ")}`] : [])
  ].join("\n\n");

  if (!dryRun && config) await sendLineText(config, [text]);
  return { checked: symbols.length, errors, text, delivered: !dryRun };
}

/** A one-off message, so the channel can be checked without waiting for a signal. */
export async function sendLineTest() {
  const config = lineConfig();
  if (!config) throw new Error("LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are not set");
  await sendLineText(config, ["✅ fin-port: การแจ้งเตือน LINE ใช้งานได้\nจะแจ้งเมื่อหุ้นใน watchlist เกิดสัญญาณ BUY/SELL ของ CDC ActionZone"]);
}
