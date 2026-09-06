"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { adminToken } from "@/lib/env";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session";
import { deleteHolding, upsertHolding } from "@/lib/data/portfolio";

/**
 * Server Actions are public HTTP endpoints, so each one re-checks the session
 * rather than trusting that middleware ran on the page that rendered the form.
 */
async function assertUnlocked() {
  const store = await cookies();
  const ok = await verifySessionCookie(store.get(SESSION_COOKIE)?.value, adminToken());
  if (!ok) throw new Error("Session expired. Reload and unlock again.");
}

export type ActionState = { error?: string; message?: string };

export async function saveHoldingAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  await assertUnlocked();

  const symbol = String(formData.get("symbol") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const costBasis = Number(formData.get("costBasis"));
  const costCurrency = String(formData.get("costCurrency") ?? "USD").trim() || "USD";

  if (!symbol) return { error: "Symbol is required." };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: "Quantity must be greater than zero." };
  if (!Number.isFinite(costBasis) || costBasis < 0) return { error: "Cost basis must be zero or more." };

  try {
    await upsertHolding({ symbol, quantity, costBasis, costCurrency });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save holding." };
  }

  revalidatePath("/portfolio");
  return { message: `${symbol.toUpperCase()} saved.` };
}

export async function removeHoldingAction(formData: FormData): Promise<void> {
  await assertUnlocked();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await deleteHolding(id);
  revalidatePath("/portfolio");
}
