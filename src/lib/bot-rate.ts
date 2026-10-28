import "server-only";

/**
 * The Bank of Thailand USD/THB reference rate, the rate THB display uses.
 * BOT publishes one rate a business day, so an hour of caching costs nothing
 * in accuracy and keeps page loads off its API and out of its quota.
 */

export type UsdThbRate = {
  base: "USD";
  quote: "THB";
  rate: number;
  period: string;
  source: string;
};

type BotReferenceRateResponse = {
  result?: {
    data?: {
      data_detail?: Array<{ period?: string; rate?: string }> | { period?: string; rate?: string };
    };
  };
};

const botReferenceRateUrl = "https://gateway.api.bot.or.th/Stat-ReferenceRate/v2/DAILY_REF_RATE/";
const CACHE_MS = 60 * 60 * 1000;
/** A page waits on this, so a slow BOT must not hold it up for long. */
const TIMEOUT_MS = 4000;

export class BotRateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

declare global {
  var __finPortBotRate: { at: number; value: UsdThbRate } | undefined;
}

export async function getUsdThbRate(): Promise<UsdThbRate> {
  const hit = globalThis.__finPortBotRate;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const apiKey = process.env.BOT_API_KEY;
  if (!apiKey) {
    throw new BotRateError("Missing BOT_API_KEY. Add a Bank of Thailand API key to enable USD to THB conversion.", 503);
  }

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 14);

  const url = new URL(botReferenceRateUrl);
  url.searchParams.set("start_period", formatDate(startDate));
  url.searchParams.set("end_period", formatDate(endDate));

  let response: Response;
  let payload: BotReferenceRateResponse;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", Authorization: apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    payload = (await response.json()) as BotReferenceRateResponse;
  } catch {
    throw new BotRateError("Unable to fetch USD/THB exchange rate from Bank of Thailand.", 502);
  }

  if (!response.ok) throw new BotRateError("Bank of Thailand exchange-rate API returned an error.", response.status);

  const latest = getLatestRate(payload);
  if (!latest) throw new BotRateError("Bank of Thailand exchange-rate API did not return a usable USD/THB rate.", 502);

  const value: UsdThbRate = {
    base: "USD",
    quote: "THB",
    rate: latest.rate,
    period: latest.period,
    source: "Bank of Thailand DAILY_REF_RATE"
  };
  globalThis.__finPortBotRate = { at: Date.now(), value };
  return value;
}

/** For pages: the rate if BOT answers, otherwise null and the page starts in USD. */
export async function getUsdThbRateOrNull(): Promise<UsdThbRate | null> {
  try {
    return await getUsdThbRate();
  } catch {
    return null;
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getLatestRate(payload: BotReferenceRateResponse) {
  const detail = payload.result?.data?.data_detail;
  const items = Array.isArray(detail) ? detail : detail ? [detail] : [];

  return items
    .map((item) => ({
      period: item.period || "",
      rate: Number(item.rate)
    }))
    .filter((item) => item.period && Number.isFinite(item.rate) && item.rate > 0)
    .sort((first, second) => second.period.localeCompare(first.period))[0];
}
