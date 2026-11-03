"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { adminToken } from "@/lib/env";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session";
import { describeCashBookRefresh, refreshCashBook } from "@/lib/cash-book/run-sync";

async function assertUnlocked() {
  const store = await cookies();
  const ok = await verifySessionCookie(store.get(SESSION_COOKIE)?.value, adminToken());
  if (!ok) throw new Error("Session expired. Reload and unlock again.");
}

export type RefreshState = { error?: string; summary?: string };

/** "Refresh" on the cash-book page: read Firefly now instead of waiting for the timer. */
export async function refreshCashBookAction(): Promise<RefreshState> {
  await assertUnlocked();

  try {
    const result = await refreshCashBook();
    revalidatePath("/cash-book");
    if (result.cash) {
      revalidatePath("/portfolio");
      revalidatePath("/allocation");
    }
    return { summary: describeCashBookRefresh(result) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Refresh failed." };
  }
}
