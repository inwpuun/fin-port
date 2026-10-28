import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { getNetWorthHistory } from "@/lib/net-worth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    return NextResponse.json(await getNetWorthHistory(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to build the net-worth history" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}
