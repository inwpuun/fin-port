import type { DrawdownRange, MarketData, MarketRange } from "@/types/market";

/**
 * Yahoo's chart API drops the odd request -- a 429, a 5xx, a socket reset --
 * and one dropped request used to put the offline demo series on screen. A
 * chart now asks again, backing off, before anyone falls back to demo data.
 */
const RETRY_DELAYS_MS = [500, 1200, 2500];

export type MarketRequest = {
  symbol: string;
  range: MarketRange;
  drawdownRange: DrawdownRange;
  overlays?: boolean;
};

export async function fetchMarketWithRetry(
  request: MarketRequest,
  { signal, onRetry }: { signal?: AbortSignal; onRetry?: (attempt: number, total: number) => void } = {}
): Promise<MarketData> {
  const url = new URL("/api/market", window.location.origin);
  url.searchParams.set("symbol", request.symbol);
  url.searchParams.set("range", request.range);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("drawdownRange", request.drawdownRange);
  if (request.overlays) url.searchParams.set("overlays", "1");

  let lastError: unknown = new Error("Unable to fetch market data");

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      onRetry?.(attempt, RETRY_DELAYS_MS.length);
      await wait(RETRY_DELAYS_MS[attempt - 1], signal);
    }

    try {
      const response = await fetch(url, { signal });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload as MarketData;

      lastError = new Error(payload.error || `Market request failed with HTTP ${response.status}`);
      // A locked session or a bad request will not fix itself on a retry.
      if (!isRetryable(response.status)) break;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

function isRetryable(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
