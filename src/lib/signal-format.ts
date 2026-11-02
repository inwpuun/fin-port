import { cdcActionZone, chartSeries, type CdcZone } from "@/lib/indicators";
import type { MarketData } from "@/types/market";

/**
 * Wording shared by every LINE message: CDC ActionZone's zones as a status in
 * words rather than a colour, and a signal's age as elapsed time rather than
 * a bar count (crypto trades at weekends, so bars do not line up across
 * symbols).
 */

export const zoneStatus: Record<CdcZone, string> = {
  green: "ขาขึ้น · ถือ/ซื้อได้",
  yellow: "ขาขึ้น · ย่อตัว",
  orange: "ขาขึ้นอ่อนแรง · ระวัง",
  red: "ขาลง · ขาย/รอ",
  lightBlue: "ขาลง · เด้งสั้น",
  blue: "ขาลง · เริ่มฟื้น รอสัญญาณซื้อ"
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "23 ต.ค." from YYYY-MM-DD. */
export function thaiDate(isoDate: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`)
  );
}

/** Calendar days from a bar's date to today, in words. */
export function timeAgo(isoDate: string, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(0, Math.round((today - Date.parse(`${isoDate}T00:00:00Z`)) / DAY_MS));
  if (days === 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 14) return `${days} วันที่แล้ว`;
  if (days < 60) return `${Math.round(days / 7)} สัปดาห์ที่แล้ว`;
  return `${Math.round(days / 30)} เดือนที่แล้ว`;
}

export type CdcRead = {
  zone: CdcZone | null;
  status: string;
  last: { type: "buy" | "sell"; time: string; price: number } | null;
};

/** The current zone and the last BUY/SELL, on the same bars the chart uses. */
export function readCdc(data: MarketData): CdcRead {
  const { candles } = chartSeries(data);
  const cdc = cdcActionZone(candles);
  const zone = cdc.zones.at(-1) ?? null;
  const signal = cdc.signals.at(-1);
  return {
    zone,
    status: zone ? zoneStatus[zone] : "ข้อมูลไม่พอ",
    last: signal ? { type: signal.type, time: signal.time, price: candles[signal.index].close } : null
  };
}

/** "SELL 16 ต.ค. (17 วันที่แล้ว)" */
export function lastSignalText(read: CdcRead) {
  if (!read.last) return "ยังไม่มีสัญญาณ";
  return `${read.last.type === "buy" ? "BUY" : "SELL"} ${thaiDate(read.last.time)} (${timeAgo(read.last.time)})`;
}

export async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        try {
          results[index] = { status: "fulfilled", value: await work(items[index]) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    })
  );
  return results;
}

/** Money for a chat message: always two decimals, "$1,234.56", "฿3,496.75". */
export function money(value: number, currency = "USD") {
  if (!Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}
