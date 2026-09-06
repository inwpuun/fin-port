import { NextRequest } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { deleteHolding, upsertHolding } from "@/lib/data/portfolio";
import { buildPortfolioView } from "@/lib/data/portfolio-view";
import { normalizeDrawdownRange } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const drawdownRange = normalizeDrawdownRange(
    request.nextUrl.searchParams.get("drawdownRange")
  );

  try {
    const view = await buildPortfolioView(drawdownRange);
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load portfolio" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    const body = await request.json();
    const symbol = String(body.symbol ?? "").trim();
    const quantity = Number(body.quantity);
    const costBasis = Number(body.costBasis);
    const costCurrency = String(body.costCurrency ?? "USD").trim();

    if (!symbol || !Number.isFinite(quantity) || quantity <= 0) {
      return Response.json({ error: "symbol and a positive quantity are required" }, { status: 400 });
    }
    if (!Number.isFinite(costBasis) || costBasis < 0) {
      return Response.json({ error: "costBasis must be a non-negative number" }, { status: 400 });
    }

    const holding = await upsertHolding({ symbol, quantity, costBasis, costCurrency });
    return Response.json({ holding }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save holding" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  try {
    await deleteHolding(id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete holding" },
      { status: 500 }
    );
  }
}
