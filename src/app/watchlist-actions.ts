"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { adminToken } from "@/lib/env";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session";
import { addWatchlistSymbol, removeWatchlistSymbol } from "@/lib/data/portfolio";

async function assertUnlocked() {
  const store = await cookies();
  const ok = await verifySessionCookie(store.get(SESSION_COOKIE)?.value, adminToken());
  if (!ok) throw new Error("Session expired. Reload and unlock again.");
}

export async function addWatchlistAction(symbol: string): Promise<string[]> {
  await assertUnlocked();
  if (symbol.trim()) await addWatchlistSymbol(symbol);
  revalidatePath("/");
  return [];
}

export async function removeWatchlistAction(symbol: string): Promise<void> {
  await assertUnlocked();
  await removeWatchlistSymbol(symbol);
  revalidatePath("/");
}
