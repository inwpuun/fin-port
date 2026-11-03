import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest } from "next/server";
import { z } from "zod";
import { isAuthorized, unauthorized } from "@/lib/auth";
import * as allocation from "@/app/api/allocation/route";
import * as fx from "@/app/api/exchange-rate/usd-thb/route";
import * as marketPrices from "@/app/api/market/prices/route";
import * as marketSummary from "@/app/api/market/summary/route";
import * as cash from "@/app/api/portfolio/cash/route";
import * as history from "@/app/api/portfolio/history/route";
import * as holdings from "@/app/api/portfolio/holdings/route";
import * as summary from "@/app/api/portfolio/summary/route";
import * as transactions from "@/app/api/portfolio/transactions/route";
import * as watchlist from "@/app/api/watchlist/my-watchlist/route";
import type { HoldingTransaction, NetWorthPoint } from "@/types/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The REST API as an MCP server (Streamable HTTP, stateless, JSON responses),
 * for agents whose shell may not run curl -- the ZeroClaw agent on the Pi.
 *
 * Same gate as every other route: `Authorization: Bearer $ADMIN_TOKEN`.
 * Each tool calls the REST handler itself with the caller's own headers, so
 * validation, auth and behaviour cannot drift from what the README documents;
 * the tools only trim responses that would otherwise send the whole trade log.
 */

type Handler = (request: NextRequest) => Promise<Response>;
type Query = Record<string, string | number | undefined>;

const SIDES = ["buy", "sell", "dividend", "fee", "deposit", "withdraw"] as const;
const date = z.string().describe("YYYY-MM-DD, or Thai d/m/yy in the Buddhist era (3/10/69 = 2026-10-03). Not in the future.");
const symbols = z.array(z.string()).min(1).max(60);

function buildServer(caller: NextRequest) {
  const server = new McpServer({ name: "fin-port", version: "1.0.0" });

  async function call(handler: Handler, method: string, path: string, query: Query = {}, body?: unknown) {
    const url = new URL(path, caller.nextUrl.origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ "content-type": "application/json" });
    for (const name of ["authorization", "cookie", "x-forwarded-for", "x-real-ip"]) {
      const value = caller.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await handler(
      new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    );
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    return { ok: response.ok, payload };
  }

  async function reply(
    handler: Handler,
    method: string,
    path: string,
    query: Query = {},
    body?: unknown,
    shape: (payload: Record<string, unknown>) => unknown = (payload) => payload
  ) {
    const { ok, payload } = await call(handler, method, path, query, body);
    if (!ok) return { isError: true, content: [{ type: "text" as const, text: String(payload.error ?? JSON.stringify(payload)) }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(shape(payload)) }] };
  }

  /** A write returns the whole log and portfolio for the page; an agent needs the row and the position it touched. */
  const writeResult = (payload: Record<string, unknown>) => {
    const transaction = payload.transaction as HoldingTransaction | undefined;
    const previous = payload.previous as HoldingTransaction | undefined;
    const touched = new Set([transaction?.symbol, previous?.symbol].filter(Boolean));
    const portfolio = (payload.portfolio as Array<{ symbol: string }> | undefined) ?? [];
    return {
      transaction,
      ...(previous ? { previous } : {}),
      holdings: portfolio.filter((row) => touched.has(row.symbol)),
      closed: [...touched].filter((symbol) => symbol !== "CASH" && !portfolio.some((row) => row.symbol === symbol)),
      cash: payload.cash
    };
  };

  // --- portfolio ---------------------------------------------------------

  server.registerTool(
    "get_portfolio_summary",
    {
      title: "Portfolio summary",
      description:
        "The portfolio priced at the last daily close: totals (marketValue, costBasis, profitLoss(%), dayChange(%), cash, netWorth, moneyIn) and every holding (price, value, P/L, day change, weight, drawdown, signal), largest first. Money is in `currency`. Symbols that could not be priced are in `errors` and left out of the totals.",
      inputSchema: {
        currency: z.enum(["THB", "USD"]).optional().describe("Default THB"),
        symbols: z.array(z.string()).optional().describe("Only these holdings; totals then leave cash out")
      },
      annotations: { readOnlyHint: true }
    },
    ({ currency, symbols: only }) =>
      reply(summary.GET, "GET", "/api/portfolio/summary", { currency, symbols: only?.join(",") })
  );

  server.registerTool(
    "list_holdings",
    {
      title: "Holdings",
      description:
        "Open positions as stored, without market prices: quantity, costBasis and averageCost (in costCurrency), allocation category, trade count; plus cash balances in USD and THB.",
      annotations: { readOnlyHint: true }
    },
    () => reply(holdings.GET, "GET", "/api/portfolio/holdings")
  );

  server.registerTool(
    "get_net_worth_history",
    {
      title: "Net worth history",
      description:
        "Net worth (value) and money in (invested), in USD, with cash and the day's THB per USD (fx), replayed from the trade log. Sampled to keep it short.",
      inputSchema: {
        from: z.string().optional().describe("YYYY-MM-DD; default one year ago"),
        every: z.enum(["day", "week", "month"]).optional().describe("Default week")
      },
      annotations: { readOnlyHint: true }
    },
    ({ from, every = "week" }) => {
      const start = from || new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      return reply(history.GET, "GET", "/api/portfolio/history", {}, undefined, (payload) => {
        const points = ((payload.points as NetWorthPoint[]) ?? []).filter((point) => point.time >= start);
        const bucket = (time: string) =>
          every === "day" ? time : every === "month" ? time.slice(0, 7) : isoWeek(time);
        // Last point of each bucket, plus always the latest day.
        const sampled = points.filter((point, index) => index === points.length - 1 || bucket(points[index + 1].time) !== bucket(point.time));
        return { ...payload, points: sampled };
      });
    }
  );

  // --- trade log -----------------------------------------------------------

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description:
        "The trade log, newest first. `total` counts matches before `limit`. symbol matches every spelling (BRK.B = BRK-B, GOLD = GC=F, BTC = BTC-USD). Pass id to fetch one row.",
      inputSchema: {
        id: z.string().optional(),
        symbol: z.string().optional(),
        sides: z.array(z.enum(SIDES)).optional(),
        from: z.string().optional().describe("occurredOn on or after, YYYY-MM-DD"),
        to: z.string().optional().describe("occurredOn on or before, YYYY-MM-DD"),
        limit: z.number().int().positive().max(500).optional().describe("Default 50")
      },
      annotations: { readOnlyHint: true }
    },
    ({ id, symbol, sides, from, to, limit }) =>
      reply(transactions.GET, "GET", "/api/portfolio/transactions", {
        id,
        symbol,
        side: sides?.join(","),
        from,
        to,
        limit: id ? undefined : (limit ?? 50)
      })
  );

  server.registerTool(
    "record_transaction",
    {
      title: "Record a transaction",
      description:
        "Records a buy, sell, dividend or fee on a symbol, or a deposit/withdraw of cash (no symbol; currency USD or THB). A buy or sell rebuilds that symbol's holding. A sell larger than what was held that day is rejected. One currency per symbol (BTC is THB). Confirm with the user before calling.",
      inputSchema: {
        side: z.enum(SIDES),
        symbol: z.string().optional().describe("Ticker; omit for deposit/withdraw"),
        quantity: z.number().positive().describe("Units, or the amount for deposit/withdraw"),
        price: z.number().positive().optional().describe("Per unit; required for buy/sell"),
        fee: z.number().min(0).optional(),
        currency: z.string().optional().describe("Default USD"),
        occurredOn: date,
        note: z.string().optional(),
        category: z.string().optional().describe("Allocation lane for a first buy, e.g. AI, Software, Finance")
      }
    },
    (input) => reply(transactions.POST, "POST", "/api/portfolio/transactions", {}, input, writeResult)
  );

  server.registerTool(
    "update_transaction",
    {
      title: "Update a transaction",
      description:
        "Edits one row of the trade log; only the fields given change. The row gets a NEW id (returned as transaction.id) and the old id stops existing. Both the old and new positions are rebuilt; an edit that breaks a later sell is rejected and nothing changes. Confirm with the user before calling.",
      inputSchema: {
        id: z.string(),
        side: z.enum(SIDES).optional(),
        symbol: z.string().optional(),
        quantity: z.number().positive().optional(),
        price: z.number().positive().optional(),
        fee: z.number().min(0).optional(),
        currency: z.string().optional(),
        occurredOn: date.optional(),
        note: z.string().nullable().optional().describe("null clears it")
      }
    },
    ({ id, ...patch }) => reply(transactions.PATCH, "PATCH", "/api/portfolio/transactions", { id }, patch, writeResult)
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "Delete a transaction",
      description: "Deletes one row of the trade log and rebuilds its position. Look the id up first; confirm with the user.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true }
    },
    ({ id }) => reply(transactions.DELETE, "DELETE", "/api/portfolio/transactions", { id }, undefined, writeResult)
  );

  server.registerTool(
    "set_cash_balances",
    {
      title: "Set cash balances",
      description:
        "Sets USD and THB cash to these totals by recording the difference as a deposit/withdraw. Send both (read the current ones with list_holdings). THB cash is rebuilt from the Firefly cash book whenever it changes, so prefer recording baht in Firefly.",
      inputSchema: { usd: z.number().min(0), thb: z.number().min(0), occurredOn: date }
    },
    (input) =>
      reply(cash.POST, "POST", "/api/portfolio/cash", {}, input, (payload) => ({ cash: payload.cash }))
  );

  // --- market --------------------------------------------------------------

  server.registerTool(
    "get_prices",
    {
      title: "Last prices",
      description: "Last daily close for any symbols (THB=X is THB per USD). Cached a minute.",
      inputSchema: { symbols },
      annotations: { readOnlyHint: true }
    },
    ({ symbols: list }) => reply(marketPrices.GET, "GET", "/api/market/prices", { symbols: list.join(",") })
  );

  server.registerTool(
    "get_market_analysis",
    {
      title: "Market analysis",
      description:
        "Price, previous close, change, drawdown from the one-year high, trend/risk/value analytics and the verdict for any symbols. Larger than get_prices; use for 'should I buy/sell X' questions.",
      inputSchema: { symbols: symbols.max(10) },
      annotations: { readOnlyHint: true }
    },
    ({ symbols: list }) => reply(marketSummary.GET, "GET", "/api/market/summary", { symbols: list.join(",") })
  );

  server.registerTool(
    "get_usd_thb_rate",
    {
      title: "USD/THB reference rate",
      description: "Bank of Thailand daily USD/THB reference rate.",
      annotations: { readOnlyHint: true }
    },
    () => reply(fx.GET, "GET", "/api/exchange-rate/usd-thb")
  );

  // --- watchlist and allocation -------------------------------------------

  server.registerTool(
    "list_watchlist",
    { title: "Watchlist", description: "Symbols on the watchlist.", annotations: { readOnlyHint: true } },
    () => reply(watchlist.GET, "GET", "/api/watchlist/my-watchlist")
  );

  server.registerTool(
    "add_to_watchlist",
    { title: "Add to watchlist", description: "Adds a symbol to the watchlist.", inputSchema: { symbol: z.string() } },
    ({ symbol }) => reply(watchlist.POST, "POST", "/api/watchlist/my-watchlist", {}, { symbol })
  );

  server.registerTool(
    "remove_from_watchlist",
    {
      title: "Remove from watchlist",
      description: "Removes a symbol from the watchlist.",
      inputSchema: { symbol: z.string() },
      annotations: { destructiveHint: true }
    },
    ({ symbol }) => reply(watchlist.DELETE, "DELETE", "/api/watchlist/my-watchlist", { symbol })
  );

  server.registerTool(
    "list_allocation",
    {
      title: "Allocation lanes",
      description: "Which allocation lane (category) each symbol is filed under.",
      annotations: { readOnlyHint: true }
    },
    () => reply(allocation.GET, "GET", "/api/allocation")
  );

  server.registerTool(
    "set_allocation",
    {
      title: "Move to a lane",
      description: "Files a holding under an allocation lane (category), moving it out of its current one.",
      inputSchema: { symbol: z.string(), category: z.string() }
    },
    ({ symbol, category }) =>
      reply(allocation.POST, "POST", "/api/allocation", {}, { symbol, category }, (payload) => ({
        symbol: payload.symbol,
        category: payload.category
      }))
  );

  return server;
}

async function handle(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  // Stateless: a fresh server and transport per request, so nothing is shared
  // between callers and any request can be served on its own.
  const server = buildServer(request);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

function isoWeek(time: string) {
  const day = new Date(`${time}T00:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${day.getUTCFullYear()}-W${week}`;
}
