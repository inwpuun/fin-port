import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { BotRateError, getUsdThbRate } from "@/lib/bot-rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Gated so an anonymous visitor cannot spend your Bank of Thailand quota.
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    return NextResponse.json(await getUsdThbRate(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof BotRateError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Unable to fetch USD/THB exchange rate from Bank of Thailand.";
    return NextResponse.json({ error: message }, { status });
  }
}
