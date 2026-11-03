import "server-only";
import { createHash } from "node:crypto";
import { fetchAssetAccounts, fetchSplits, fireflyConfig } from "@/lib/firefly";
import { mapFirefly, type CashBook } from "./firefly-map";

/**
 * The cash book, read straight from Firefly III and held in memory.
 *
 * Nothing is copied into Postgres. A full read of Firefly takes ~3 s on the
 * Pi, so the last one is kept here (~2 MB for 3k rows) and served at once;
 * when it is older than FIREFLY_REFRESH_MINUTES the next read returns it and
 * refreshes in the background (stale-while-revalidate). The timer in
 * instrumentation-node.ts keeps it warm, so a page only waits on the very
 * first read after a restart.
 */

type Loaded = { book: CashBook; fingerprint: string; fetchedAt: number };

declare global {
  var __finPortFireflyBook: Loaded | undefined;
  var __finPortFireflyLoading: Promise<Loaded> | undefined;
}

export function refreshMinutes() {
  const minutes = Number(process.env.FIREFLY_REFRESH_MINUTES ?? 2);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 2;
}

function fingerprintOf(book: CashBook) {
  return createHash("sha256").update(JSON.stringify([book.rows, book.accounts])).digest("hex");
}

/** One read of Firefly at a time; callers arriving meanwhile share it. */
function load(): Promise<Loaded> {
  globalThis.__finPortFireflyLoading ??= (async () => {
    const config = fireflyConfig();
    if (!config) throw new Error("FIREFLY_URL and FIREFLY_TOKEN are not set.");

    const [accounts, splits] = await Promise.all([fetchAssetAccounts(config), fetchSplits(config)]);
    const book = mapFirefly(accounts, splits);
    const loaded = { book, fingerprint: fingerprintOf(book), fetchedAt: Date.now() };
    globalThis.__finPortFireflyBook = loaded;
    return loaded;
  })().finally(() => {
    globalThis.__finPortFireflyLoading = undefined;
  });

  return globalThis.__finPortFireflyLoading;
}

/** The cash book, from memory when possible. Throws only when nothing has ever loaded. */
export async function getCashBook(): Promise<CashBook> {
  const cached = globalThis.__finPortFireflyBook;
  if (!cached) return (await load()).book;

  if (Date.now() - cached.fetchedAt > refreshMinutes() * 60_000) {
    load().catch((error) => console.error("cash book refresh failed:", error instanceof Error ? error.message : error));
  }
  return cached.book;
}

/** Reads Firefly now. `changed` compares with what was in memory before. */
export async function reloadCashBook(): Promise<{ book: CashBook; fingerprint: string; changed: boolean }> {
  const before = globalThis.__finPortFireflyBook?.fingerprint;
  const loaded = await load();
  return { book: loaded.book, fingerprint: loaded.fingerprint, changed: loaded.fingerprint !== before };
}

/** What is in memory, without ever reaching Firefly. For the "Updated" label. */
export function peekCashBook(): CashBook | null {
  return globalThis.__finPortFireflyBook?.book ?? null;
}
