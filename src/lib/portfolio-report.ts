import "server-only";
import { query, queryOne } from "@/lib/db/client";
import { lineConfig } from "@/lib/env";
import { percentFormat } from "@/lib/format";
import { getUsdThbRateOrNull } from "@/lib/bot-rate";
import { chartSeries } from "@/lib/indicators";
import { sendLineText } from "@/lib/line";
import { fetchMarketData } from "@/lib/market";
import { getMyPortfolioSeed } from "@/lib/my-port";
import { lastSignalText, mapLimited, money, readCdc, thaiDate, type CdcRead } from "@/lib/signal-format";
import {
  addDays,
  isTradingDay,
  monthCloseDay,
  previousMonthCloseDay,
  weekCloseDay,
  weekStart
} from "@/lib/us-market-calendar";
import type { MarketData } from "@/types/market";

/**
 * A LINE report on every holding, sent at the US close: how much each
 * position made or lost over the period, and where it stands on CDC
 * ActionZone.
 *
 * Gains are real, not "today's quantity times the price move": the position
 * at the start of the period is rebuilt from the trade log, and every buy,
 * sell and fee inside the period is counted at the price actually paid.
 *
 *   gain = value now - quantity at start x price at start - bought + sold - fees
 *
 * Periods, on the NYSE calendar (us-market-calendar.ts):
 *  - day:   from the previous close.
 *  - week:  sent on the week's last trading day (Friday, or Thursday when
 *           Friday is a holiday such as Good Friday), from the last close
 *           before Monday.
 *  - month: sent instead of the week on the close of the week holding the
 *           month's last Friday, from the previous month's report day. Days
 *           after it belong to next month.
 *
 * 16:05 New York time, so daylight saving is handled: 03:05 in Bangkok in
 * the US summer, 04:05 in winter. Market holidays send nothing.
 */

export type ReportKind = "open" | "close";
export type ReportPeriod = "day" | "week" | "month";

const SLOTS: Record<ReportKind, { minutes: number; title: string }> = {
  open: { minutes: 9 * 60 + 35, title: "🔔 ตลาด US เปิด" },
  close: { minutes: 16 * 60 + 5, title: "🏁 ตลาด US ปิด" }
};
/**
 * Only the close is sent on a schedule; the open report was dropped as noise.
 * `?report=open` on the route still sends one by hand.
 */
const SCHEDULED: ReportKind[] = ["close"];
/** A Pi that was down at the bell still reports if it is back within this. */
const WINDOW_MINUTES = 60;
const CONCURRENCY = 4;

const PERIOD_COPY: Record<ReportPeriod, { title: string; label: string }> = {
  day: { title: "", label: "วันนี้" },
  week: { title: "📅 สรุปสัปดาห์", label: "สัปดาห์นี้" },
  month: { title: "🗓️ สรุปเดือน", label: "เดือนนี้" }
};

type Trade = { symbol: string; side: "buy" | "sell"; quantity: number; price: number; fee: number; currency: string; occurredOn: string };

type Gain = {
  /** Price at the close the period starts from; null when there is no bar that old. */
  basePrice: number | null;
  startQuantity: number;
  /** What the position was worth at the start, plus everything paid in during it. */
  invested: number;
  gain: number;
  trades: Trade[];
};

type Row = {
  symbol: string;
  data: MarketData;
  read: CdcRead;
  quantity: number;
  value: number;
  costUsd: number | null;
  period: Gain;
  /** Week-to-date, for the month report's header. */
  week: Gain;
};

function newYorkClock(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

/** Which report a close on `date` is: the month, the week, or the day. */
export function closePeriod(date: string): ReportPeriod {
  if (weekCloseDay(date) !== date) return "day";
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return monthCloseDay(year, month) === date ? "month" : "week";
}

/** The day whose close a period is measured from. Trades after it fall inside the period. */
function baseDate(period: ReportPeriod, today: string) {
  if (period === "month") return previousMonthCloseDay(today);
  if (period === "week") return addDays(weekStart(today), -1);
  return addDays(today, -1);
}

function closeOn(data: MarketData, date: string) {
  const { candles } = chartSeries(data);
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index].time <= date) return candles[index].close;
  }
  return null;
}

function gainSince(
  data: MarketData,
  quantity: number,
  trades: Trade[],
  base: string,
  today: string,
  toQuote: (amount: number, currency: string) => number
): Gain {
  const inside = trades.filter((trade) => trade.occurredOn > base && trade.occurredOn <= today);
  let bought = 0;
  let sold = 0;
  let netQuantity = 0;
  for (const trade of inside) {
    const amount = toQuote(trade.quantity * trade.price, trade.currency);
    const fee = toQuote(trade.fee, trade.currency);
    if (trade.side === "buy") {
      bought += amount + fee;
      netQuantity += trade.quantity;
    } else {
      sold += amount - fee;
      netQuantity -= trade.quantity;
    }
  }

  // Quantity now is the holdings row, which the trade log rebuilds; walking
  // back over the period's trades gives what was held when it began.
  const startQuantity = Math.max(0, quantity - netQuantity);
  const basePrice = closeOn(data, base);
  const startValue = startQuantity * (basePrice ?? data.price);
  return {
    basePrice,
    startQuantity,
    invested: startValue + bought,
    gain: quantity * data.price + sold - startValue - bought,
    trades: inside
  };
}

function signed(value: number, currency: string) {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value), currency)}`;
}

function percentOf(gain: number, invested: number) {
  return percentFormat(invested ? (gain / invested) * 100 : 0);
}

function formatQuantity(quantity: number) {
  return quantity.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export async function buildPortfolioReport(kind: ReportKind, now = new Date(), period: ReportPeriod = "day") {
  const clock = newYorkClock(now);
  const seeds = (await getMyPortfolioSeed()).filter((seed) => (seed.quantity ?? 0) > 0);
  const [rate, results, tradeRows] = await Promise.all([
    getUsdThbRateOrNull(),
    mapLimited(seeds, CONCURRENCY, (seed) => fetchMarketData(seed.symbol, "1y", "1d", "1y", true)),
    query<{ symbol: string; side: "buy" | "sell"; quantity: string; price: string; fee: string; currency: string; occurred_on: string }>(
      `select symbol, side, quantity, price, fee, currency, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on
         from holding_transactions
        where side in ('buy', 'sell') and occurred_on > $1
        order by occurred_on, id`,
      // The earliest any period can start: the month's base is at most ~5 weeks back.
      [addDays(clock.date, -45)]
    )
  ]);
  const usdThb = rate?.rate ?? null;

  const trades: Trade[] = tradeRows.map((row) => ({
    symbol: row.symbol.trim().toUpperCase(),
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fee: Number(row.fee),
    currency: row.currency.toUpperCase(),
    occurredOn: row.occurred_on
  }));

  const missingRate = new Set<string>();
  const toQuoteFor = (symbol: string, quote: string) => (amount: number, currency: string) => {
    if (currency === quote) return amount;
    if (currency === "THB" && quote === "USD" && usdThb) return amount / usdThb;
    if (currency === "USD" && quote === "THB" && usdThb) return amount * usdThb;
    missingRate.add(symbol);
    return amount;
  };

  const periodBase = baseDate(period, clock.date);
  const weekBase = baseDate("week", clock.date);

  const rows: Row[] = [];
  const errors: Record<string, string> = {};
  results.forEach((result, index) => {
    const seed = seeds[index];
    if (result.status === "rejected") {
      errors[seed.symbol] = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return;
    }
    const data = result.value;
    const quantity = seed.quantity ?? 0;
    const cost = seed.costBasis ?? 0;
    const costUsd = seed.costCurrency === "USD" ? cost : seed.costCurrency === "THB" && usdThb ? cost / usdThb : null;
    const own = trades.filter((trade) => trade.symbol === seed.symbol.toUpperCase());
    const toQuote = toQuoteFor(seed.symbol, data.currency);
    rows.push({
      symbol: seed.symbol,
      data,
      read: readCdc(data),
      quantity,
      value: quantity * data.price,
      costUsd,
      period: gainSince(data, quantity, own, periodBase, clock.date, toQuote),
      week: gainSince(data, quantity, own, weekBase, clock.date, toQuote)
    });
  });

  // Holidays come from the calendar; the bar check catches a day the
  // calendar does not know about (an unscheduled closure).
  const tradedToday =
    isTradingDay(clock.date) && rows.some((row) => row.data.type === "equity" && row.data.candles.at(-1)?.time === clock.date);

  // Totals in USD: every holding here is quoted in dollars. Anything that is
  // not is left out of the total and says so.
  const usd = rows.filter((row) => row.data.currency === "USD");
  const sum = (pick: (row: Row) => number) => usd.reduce((total, row) => total + pick(row), 0);
  const value = sum((row) => row.value);
  const gain = sum((row) => row.period.gain);
  const invested = sum((row) => row.period.invested);
  const weekGain = sum((row) => row.week.gain);
  const weekInvested = sum((row) => row.week.invested);
  const priced = usd.filter((row) => row.costUsd !== null);
  const cost = priced.reduce((total, row) => total + row.costUsd!, 0);
  const totalGain = priced.reduce((total, row) => total + row.value, 0) - cost;
  const thb = (amount: number) => (usdThb ? ` (≈ ${signed(amount * usdThb, "THB")})` : "");

  rows.sort((a, b) => b.period.gain - a.period.gain);

  const block = (row: Row) => {
    const { basePrice, startQuantity, gain: rowGain, invested: rowInvested, trades: inside } = row.period;
    const move = basePrice ? ((row.data.price - basePrice) / basePrice) * 100 : 0;
    const lines = [
      `${rowGain >= 0 ? "▲" : "▼"} ${row.data.symbol} ${signed(rowGain, row.data.currency)} (${percentOf(rowGain, rowInvested)})`,
      `   ${money(row.data.price, row.data.currency)}${basePrice ? ` · ราคา ${percentFormat(move)}` : ""} · ${row.read.status}`
    ];
    for (const trade of inside) {
      lines.push(
        `   ${trade.side === "buy" ? "ซื้อ" : "ขาย"} ${formatQuantity(trade.quantity)} หุ้น ${thaiDate(trade.occurredOn)} @ ${money(trade.price, trade.currency)}`
      );
    }
    if (inside.length && startQuantity === 0) lines.push("   (เริ่มถือในช่วงนี้ คิดจากราคาที่ซื้อจริง)");
    lines.push(`   สัญญาณล่าสุด ${lastSignalText(row.read)}`);
    return lines.join("\n");
  };

  const dateText = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${clock.date}T00:00:00Z`)
  );
  const range = `${thaiDate(addDays(periodBase, 1))} – ${thaiDate(clock.date)}`;
  const title =
    period === "day"
      ? `${SLOTS[kind].title} · ${dateText}`
      : period === "month"
        ? `${PERIOD_COPY.month.title} ${new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${clock.date}T00:00:00Z`))} · ${range}`
        : `${PERIOD_COPY.week.title} · ${range}`;
  const header = [
    title,
    `พอร์ต${PERIOD_COPY[period].label} ${signed(gain, "USD")} (${percentOf(gain, invested)})${thb(gain)}`,
    ...(period === "month" ? [`พอร์ตสัปดาห์นี้ ${signed(weekGain, "USD")} (${percentOf(weekGain, weekInvested)})${thb(weekGain)}`] : []),
    `มูลค่า ${money(value, "USD")} · กำไรรวม ${signed(totalGain, "USD")} (${percentFormat(cost ? (totalGain / cost) * 100 : 0)})`
  ].join("\n");

  const notes: string[] = [];
  const other = rows.filter((row) => row.data.currency !== "USD").map((row) => row.symbol);
  if (other.length) notes.push(`ไม่รวมในยอดรวม (ไม่ใช่ USD): ${other.join(", ")}`);
  if (missingRate.size) notes.push(`ไม่มีอัตราแลกเปลี่ยน คิดราคาซื้อขายตามสกุลเดิม: ${[...missingRate].join(", ")}`);
  if (Object.keys(errors).length) notes.push(`ดึงราคาไม่ได้: ${Object.keys(errors).join(", ")}`);
  notes.push("กำไร/ขาดทุนคิดจากรายการซื้อขายจริง · BTC/ทอง นับวันตามเวลา UTC");

  const text = [header, ...rows.map(block), notes.join("\n")].join("\n\n");
  return { text, tradedToday, date: clock.date, period, errors, holdings: rows.length };
}

export async function sendPortfolioReport(kind: ReportKind, { dryRun = false, period = "day" as ReportPeriod } = {}) {
  const config = lineConfig();
  if (!config && !dryRun) throw new Error("LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are not set");
  const report = await buildPortfolioReport(kind, new Date(), period);
  if (!dryRun && config) await sendLineText(config, [report.text]);
  return { ...report, delivered: !dryRun };
}

/**
 * Called every minute by the scheduler. Cheap until a slot is due: the clock
 * and the calendar are checked before anything touches the network or the
 * database.
 */
export async function runPortfolioReportIfDue(now = new Date()) {
  const clock = newYorkClock(now);
  if (!isTradingDay(clock.date)) return null;

  const kind = SCHEDULED.find((slot) => {
    const offset = clock.minutes - SLOTS[slot].minutes;
    return offset >= 0 && offset < WINDOW_MINUTES;
  });
  if (!kind) return null;

  // Claim the slot first, so a restart or a second process cannot send it twice.
  const claimed = await queryOne<{ kind: string }>(
    `insert into portfolio_reports (report_date, kind) values ($1, $2)
     on conflict do nothing returning kind`,
    [clock.date, kind]
  );
  if (!claimed) return null;

  try {
    const config = lineConfig();
    if (!config) throw new Error("LINE is not configured");
    const period = kind === "close" ? closePeriod(clock.date) : "day";
    const report = await buildPortfolioReport(kind, now, period);
    if (!report.tradedToday) {
      await query(`update portfolio_reports set status = 'holiday' where report_date = $1 and kind = $2`, [clock.date, kind]);
      return { kind, status: "holiday" as const };
    }
    await sendLineText(config, [report.text]);
    await query(`update portfolio_reports set status = 'sent', sent_at = now() where report_date = $1 and kind = $2`, [clock.date, kind]);
    return { kind: `${kind}/${period}`, status: "sent" as const, holdings: report.holdings };
  } catch (error) {
    // Give the slot back so the next minute retries, while the window lasts.
    await query(`delete from portfolio_reports where report_date = $1 and kind = $2`, [clock.date, kind]);
    throw error;
  }
}
