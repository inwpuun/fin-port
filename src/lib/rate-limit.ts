import "server-only";
import { headers } from "next/headers";

/**
 * Fixed-window rate limiter for failed authentication attempts.
 *
 * Honest about its limits: state lives in the instance's memory, so on Vercel
 * each serverless instance counts separately and a burst spread across
 * instances gets a higher effective ceiling. It is defence in depth, not the
 * thing standing between an attacker and the data -- a 256-bit ADMIN_TOKEN is
 * what makes guessing hopeless. This exists so a *weak* token cannot be
 * hammered for free, and so noisy probing costs the attacker something.
 *
 * For a hard global limit, put Vercel's WAF in front of /unlock, or move these
 * counters into Postgres.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-lived instance. */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [candidate, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(candidate);
      }
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  }

  return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Clears a bucket, so a successful unlock does not count against the user. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client identity. On Vercel `x-forwarded-for` is set by the edge
 * and its leftmost entry is the real client; the header is spoofable in other
 * deployments, which is another reason this is not the primary control.
 */
export async function clientKey(prefix: string): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || store.get("x-real-ip") || "unknown";
  return `${prefix}:${ip}`;
}
