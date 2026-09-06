import "server-only";

/**
 * The holdings sheet prices BTC in THB while everything else is USD, and the
 * cash allocation is THB. Totals would be meaningless without converting, so
 * pull spot FX from the same Yahoo endpoint the price data comes from.
 */

type RateCache = { rates: Map<string, number>; fetchedAt: number };

const TTL_MS = 10 * 60 * 1000;
let cache: RateCache = { rates: new Map(), fetchedAt: 0 };

async function fetchRate(pair: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?range=5d&interval=1d`;

  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; fin-port/1.0)" },
      next: { revalidate: 600 }
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
    const latest = [...closes].reverse().find((value) => typeof value === "number" && value > 0);
    return typeof latest === "number" ? latest : null;
  } catch {
    return null;
  }
}

/**
 * Returns the multiplier that converts `from` into `to`, or null when the rate
 * is unavailable. Callers must treat null as "leave the number alone and say
 * so in the UI" rather than silently assuming 1.
 */
export async function getFxRate(from: string, to: string): Promise<number | null> {
  const base = from.trim().toUpperCase();
  const quote = to.trim().toUpperCase();
  if (!base || !quote || base === quote) return 1;

  const key = `${base}${quote}`;
  const now = Date.now();
  if (now - cache.fetchedAt > TTL_MS) cache = { rates: new Map(), fetchedAt: now };
  const cached = cache.rates.get(key);
  if (cached) return cached;

  const direct = await fetchRate(`${base}${quote}=X`);
  if (direct) {
    cache.rates.set(key, direct);
    return direct;
  }

  const inverse = await fetchRate(`${quote}${base}=X`);
  if (inverse && inverse > 0) {
    const rate = 1 / inverse;
    cache.rates.set(key, rate);
    return rate;
  }

  return null;
}

export async function convert(amount: number, from: string, to: string): Promise<number | null> {
  const rate = await getFxRate(from, to);
  return rate === null ? null : amount * rate;
}
