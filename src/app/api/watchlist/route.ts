import { NextRequest } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { addWatchlistSymbol, listWatchlist, removeWatchlistSymbol } from "@/lib/data/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    return Response.json({ items: await listWatchlist() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load watchlist" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    const body = await request.json();
    const symbol = String(body.symbol ?? "").trim();
    if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });

    return Response.json({ item: await addWatchlistSymbol(symbol) }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to add symbol" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });

  try {
    await removeWatchlistSymbol(symbol);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to remove symbol" },
      { status: 500 }
    );
  }
}
