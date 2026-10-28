import { createHash } from "node:crypto";
import { parseCsv } from "@/lib/csv";
import { num, type Db } from "@/lib/db/sql";
import { normalizeSymbol } from "@/lib/market";
import type { CashBalances, HoldingTransaction, TransactionSide } from "@/types/portfolio";

/**
 * The trade log, and the rule that keeps `holdings` in step with it.
 *
 * `holdings` stays the table every page reads, so nothing downstream had to
 * change. What changes is who writes it: once a symbol has a buy or a sell in
 * holding_transactions, its holdings row is a cache of replaying those trades
 * in date order, recomputed after every insert or delete. A symbol with no
 * trades keeps the hand-entered row it always had.
 *
 * Deliberately NOT `server-only`: scripts/import-trades.ts runs this under tsx
 * against its own client, the same way the cash-book importer does.
 */

export const CASH_SYMBOL = "CASH";
export const CASH_CURRENCIES = ["USD", "THB"] as const;
export const SHEET_IMPORT_NOTE = "sheet import";
export const OPENING_NOTE = "opening balance";
const ADJUSTMENT_NOTE = "balance adjustment";

const SIDES: TransactionSide[] = ["buy", "sell", "dividend", "fee", "deposit", "withdraw"];
const CASH_SIDES = new Set<TransactionSide>(["deposit", "withdraw"]);

/** Fractional shares go to 7-8 places; anything below this is rounding dust. */
const EPSILON = 1e-8;
/**
 * Brokers round each fill on its own, so selling "everything" can come out a
 * unit in the 7th place above the sum of the buys (GOOG, April 2024: bought
 * 1.2583077, sold 1.2583078). Within this margin a sell closes the position.
 */
const SELL_TOLERANCE = 1e-6;

export type TransactionInput = {
  symbol?: string;
  side: string;
  quantity: number;
  price?: number;
  fee?: number;
  currency?: string;
  occurredOn: string;
  note?: string | null;
};

type TransactionRow = {
  id: string;
  symbol: string;
  side: TransactionSide;
  quantity: string;
  price: string;
  fee: string;
  currency: string;
  occurred_on: string;
  note: string | null;
};

// `date` columns would arrive as a JS Date at local midnight, which shifts a
// day under any non-UTC TZ. Formatting in SQL keeps them as plain strings.
const SELECT_COLUMNS = `id, symbol, side, quantity, price, fee, currency,
  to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, note`;

const ORDER = `occurred_on, created_at, id`;

function rowToTransaction(row: TransactionRow): HoldingTransaction {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    quantity: num(row.quantity) ?? 0,
    price: num(row.price) ?? 0,
    fee: num(row.fee) ?? 0,
    currency: row.currency,
    occurredOn: row.occurred_on,
    note: row.note
  };
}

export function isCashSide(side: TransactionSide) {
  return CASH_SIDES.has(side);
}

export function isPositionTrade(transaction: Pick<HoldingTransaction, "side">) {
  return transaction.side === "buy" || transaction.side === "sell";
}

/** BRK.B and BRK-B are one position; GOLD and GC=F too. */
export function symbolKey(symbol: string) {
  return normalizeSymbol(symbol);
}

/**
 * Validates a trade from a form or an import and fills in what the side
 * implies: a cash move is always the CASH symbol at a price of 1.
 */
export function normalizeTransaction(input: TransactionInput): Omit<HoldingTransaction, "id"> {
  const side = String(input.side || "").trim().toLowerCase() as TransactionSide;
  if (!SIDES.includes(side)) throw new Error(`Unknown transaction type "${input.side}"`);

  const occurredOn = normalizeDate(input.occurredOn);
  const quantity = Number(input.quantity);
  const fee = Number(input.fee ?? 0);
  const currency = String(input.currency || "USD").trim().toUpperCase();
  const note = input.note?.trim() || null;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(isCashSide(side) ? "Amount must be greater than zero" : "Quantity must be greater than zero");
  }
  if (!Number.isFinite(fee) || fee < 0) throw new Error("Fee must be zero or more");

  if (isCashSide(side)) {
    if (!(CASH_CURRENCIES as readonly string[]).includes(currency)) {
      throw new Error(`Cash is kept in ${CASH_CURRENCIES.join(" or ")}, not ${currency}`);
    }
    return { symbol: CASH_SYMBOL, side, quantity, price: 1, fee: 0, currency, occurredOn, note };
  }

  const symbol = String(input.symbol || "").trim().toUpperCase();
  const price = Number(input.price ?? 0);

  if (!symbol) throw new Error("Symbol is required");
  if (symbol === CASH_SYMBOL) throw new Error("Use a deposit or withdrawal to move cash");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`"${currency}" is not a currency code`);
  if (isPositionTrade({ side }) && (!Number.isFinite(price) || price <= 0)) {
    throw new Error("Price must be greater than zero");
  }

  return { symbol, side, quantity, price: Number.isFinite(price) ? price : 0, fee, currency, occurredOn, note };
}

/**
 * Accepts ISO dates and the sheet's Thai short form, d/m/yy in the Buddhist
 * era: "3/10/69" is 3 October 2569 BE, which is 2026.
 */
export function normalizeDate(raw: string): string {
  const value = String(raw || "").trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slashed = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);

  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (slashed) {
    [day, month, year] = [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])];
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;
  } else {
    throw new Error(`"${value}" is not a date (use YYYY-MM-DD or d/m/yy)`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`"${value}" is not a valid date`);
  }

  // One day of slack for Bangkok being ahead of UTC.
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new Error(`${value} is in the future`);

  return date.toISOString().slice(0, 10);
}

export type PositionState = { quantity: number; cost: number };

/**
 * One trade applied to a running position. A sell takes out its share of the
 * cost at the average price, so what remains keeps the same average -- the
 * same figure the holdings table has always shown as the buy price.
 */
export function applyTrade(state: PositionState, trade: HoldingTransaction): PositionState {
  if (trade.side === "buy") {
    return { quantity: state.quantity + trade.quantity, cost: state.cost + trade.quantity * trade.price + trade.fee };
  }

  if (trade.side === "sell") {
    if (trade.quantity > state.quantity + SELL_TOLERANCE) {
      throw new Error(
        `Cannot sell ${trade.quantity} ${trade.symbol} on ${trade.occurredOn}: only ${roundTo(state.quantity, 8)} held then`
      );
    }
    const remaining = state.quantity - trade.quantity;
    if (remaining <= EPSILON) return { quantity: 0, cost: 0 };
    return { quantity: remaining, cost: state.cost * (remaining / state.quantity) };
  }

  return state;
}

export function applyCash(balances: CashBalances, move: HoldingTransaction): CashBalances {
  if (!isCashSide(move.side)) return balances;
  const currency = move.currency as keyof CashBalances;
  const delta = move.side === "deposit" ? move.quantity : -move.quantity;
  return { ...balances, [currency]: (balances[currency] ?? 0) + delta };
}

export async function listTransactions(db: Db): Promise<HoldingTransaction[]> {
  const { rows } = await db.query<TransactionRow>(
    `select ${SELECT_COLUMNS} from holding_transactions order by ${ORDER}`
  );
  return rows.map(rowToTransaction);
}

/** Every buy and sell for one position, oldest first, whatever spelling it was entered under. */
async function positionTrades(db: Db, symbol: string): Promise<HoldingTransaction[]> {
  const key = symbolKey(symbol);
  const { rows } = await db.query<TransactionRow>(
    `select ${SELECT_COLUMNS} from holding_transactions
      where side in ('buy', 'sell') order by ${ORDER}`
  );
  return rows.map(rowToTransaction).filter((trade) => symbolKey(trade.symbol) === key);
}

async function cashMoves(db: Db): Promise<HoldingTransaction[]> {
  const { rows } = await db.query<TransactionRow>(
    `select ${SELECT_COLUMNS} from holding_transactions
      where side in ('deposit', 'withdraw') order by ${ORDER}`
  );
  return rows.map(rowToTransaction);
}

export async function hasPositionTrades(db: Db, symbol: string) {
  return (await positionTrades(db, symbol)).length > 0;
}

type HoldingRow = { symbol: string; quantity: string; cost_basis: string; cost_currency: string; created_on: string };

async function findHolding(db: Db, symbol: string) {
  const key = symbolKey(symbol);
  const { rows } = await db.query<HoldingRow>(
    `select symbol, quantity, cost_basis, cost_currency,
            to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as created_on
       from holdings`
  );
  return rows.find((row) => symbolKey(row.symbol) === key) ?? null;
}

type CashRuleRow = { cash_value: string | null; cash_currency: string | null; created_on: string };

async function findCashRule(db: Db) {
  const { rows } = await db.query<CashRuleRow>(
    `select cash_value, cash_currency,
            to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as created_on
       from allocations where upper(symbol) = $1
      order by created_at limit 1`,
    [CASH_SYMBOL]
  );
  return rows[0] ?? null;
}

/**
 * Ids are content hashes plus an occurrence index, the same scheme as
 * cash_transactions: two identical buys on one day stay two rows, and an
 * import that is re-run computes the same ids instead of duplicating.
 */
async function insertTransactions(db: Db, trades: Array<Omit<HoldingTransaction, "id">>) {
  if (!trades.length) return [];

  const fingerprints = trades.map((trade) =>
    createHash("sha256")
      .update(
        [trade.symbol, trade.side, trade.quantity, trade.price, trade.fee, trade.currency, trade.occurredOn].join("|")
      )
      .digest("hex")
      .slice(0, 32)
  );

  const { rows } = await db.query<{ fingerprint: string; taken: string }>(
    `select split_part(id, ':', 1) as fingerprint, count(*) as taken
       from holding_transactions
      where split_part(id, ':', 1) = any($1::text[])
      group by 1`,
    [fingerprints]
  );
  const next = new Map(rows.map((row) => [row.fingerprint, Number(row.taken)]));

  const values: unknown[] = [];
  const tuples: string[] = [];
  const inserted: HoldingTransaction[] = [];

  trades.forEach((trade, index) => {
    const occurrence = next.get(fingerprints[index]) ?? 0;
    next.set(fingerprints[index], occurrence + 1);
    const id = `${fingerprints[index]}:${occurrence}`;

    const row = [id, trade.symbol, trade.side, trade.quantity, trade.price, trade.fee, trade.currency, trade.occurredOn, trade.note];
    tuples.push(`(${row.map((_, column) => `$${values.length + column + 1}`).join(", ")})`);
    values.push(...row);
    inserted.push({ id, ...trade });
  });

  await db.query(
    `insert into holding_transactions (id, symbol, side, quantity, price, fee, currency, occurred_on, note)
     values ${tuples.join(", ")}`,
    values
  );

  return inserted;
}

/**
 * The first trade on a symbol that already has a hand-entered holding would
 * otherwise replace that holding with just the new trade. Carry the existing
 * position into the log as an opening buy at its average cost first, dated
 * no later than the new trade so a back-dated sell still has shares to sell.
 */
async function ensureOpeningPosition(db: Db, symbol: string, before: string) {
  if (await hasPositionTrades(db, symbol)) return;

  const holding = await findHolding(db, symbol);
  const quantity = num(holding?.quantity) ?? 0;
  const cost = num(holding?.cost_basis) ?? 0;
  if (!holding || quantity <= 0) return;

  await insertTransactions(db, [
    {
      symbol: holding.symbol,
      side: "buy",
      quantity,
      price: cost / quantity,
      fee: 0,
      currency: holding.cost_currency || "USD",
      occurredOn: holding.created_on < before ? holding.created_on : before,
      note: OPENING_NOTE
    }
  ]);
}

/** Same idea for cash: the old single CASH value becomes the first deposit. */
async function ensureOpeningCash(db: Db, before: string) {
  if ((await cashMoves(db)).length) return;

  const rule = await findCashRule(db);
  const value = num(rule?.cash_value) ?? 0;
  const currency = (rule?.cash_currency || "").toUpperCase();

  if (rule && value > 0 && (CASH_CURRENCIES as readonly string[]).includes(currency)) {
    await insertTransactions(db, [
      {
        symbol: CASH_SYMBOL,
        side: "deposit",
        quantity: value,
        price: 1,
        fee: 0,
        currency,
        occurredOn: rule.created_on < before ? rule.created_on : before,
        note: OPENING_NOTE
      }
    ]);
  }

  // The log owns the balance from here on. Leaving the old literal in place
  // would make it reappear if every cash row were later deleted.
  await db.query(`update allocations set cash_value = null, cash_currency = null where upper(symbol) = $1`, [
    CASH_SYMBOL
  ]);
}

/**
 * Replays a symbol's trades into its holdings row. Throws on a sell that
 * exceeds what was held, so the caller's transaction rolls the bad trade back.
 * Returns false when the position is now closed and the row was removed.
 */
export async function recomputeHolding(db: Db, symbol: string): Promise<boolean> {
  const trades = await positionTrades(db, symbol);
  const existing = await findHolding(db, symbol);

  const currencies = new Set(trades.map((trade) => trade.currency));
  if (currencies.size > 1) {
    throw new Error(`${symbol} has trades in ${[...currencies].join(" and ")}; keep one currency per symbol`);
  }

  const state = trades.reduce(applyTrade, { quantity: 0, cost: 0 });

  if (state.quantity <= EPSILON) {
    if (existing) await db.query(`delete from holdings where symbol = $1`, [existing.symbol]);
    return false;
  }

  await db.query(
    `insert into holdings (symbol, quantity, cost_basis, cost_currency)
          values ($1, $2, $3, $4)
     on conflict (symbol)
     do update set quantity = excluded.quantity,
                   cost_basis = excluded.cost_basis,
                   cost_currency = excluded.cost_currency`,
    [existing?.symbol ?? trades[0].symbol, roundTo(state.quantity, 10), roundTo(state.cost, 4), trades[0].currency]
  );
  return true;
}

/** Throws if any withdrawal ever took a balance below zero. */
async function assertCashNeverNegative(db: Db) {
  let balances: CashBalances = { USD: 0, THB: 0 };

  for (const move of await cashMoves(db)) {
    balances = applyCash(balances, move);
    const currency = move.currency as keyof CashBalances;
    if (balances[currency] < -0.005) {
      throw new Error(`Withdrawal on ${move.occurredOn} takes the ${currency} balance below zero`);
    }
  }
}

export async function getCashBalances(db: Db): Promise<CashBalances> {
  const moves = await cashMoves(db);

  if (!moves.length) {
    // Nothing recorded yet: fall back to the literal on the CASH allocation.
    const rule = await findCashRule(db);
    const value = num(rule?.cash_value) ?? 0;
    const currency = (rule?.cash_currency || "").toUpperCase();
    return {
      USD: currency === "USD" ? value : 0,
      THB: currency === "THB" ? value : 0
    };
  }

  const balances = moves.reduce(applyCash, { USD: 0, THB: 0 });
  return { USD: roundTo(balances.USD, 4), THB: roundTo(balances.THB, 4) };
}

export type TransactionWriteResult = {
  transaction: HoldingTransaction;
  /** False when a sell closed the position and its holdings row was removed. */
  open: boolean;
};

/** Run inside a transaction: a rejected sell must not leave its row behind. */
export async function addTransaction(db: Db, input: TransactionInput): Promise<TransactionWriteResult> {
  const trade = normalizeTransaction(input);

  if (isCashSide(trade.side)) {
    await ensureOpeningCash(db, trade.occurredOn);
    const [transaction] = await insertTransactions(db, [trade]);
    await assertCashNeverNegative(db);
    return { transaction, open: true };
  }

  if (!isPositionTrade(trade)) {
    // Dividends and standalone fees are kept for the record but move nothing.
    const [transaction] = await insertTransactions(db, [trade]);
    return { transaction, open: true };
  }

  await ensureOpeningPosition(db, trade.symbol, trade.occurredOn);
  const [transaction] = await insertTransactions(db, [trade]);
  const open = await recomputeHolding(db, trade.symbol);
  return { transaction, open };
}

export async function deleteTransaction(db: Db, id: string): Promise<TransactionWriteResult | null> {
  const { rows } = await db.query<TransactionRow>(
    `delete from holding_transactions where id = $1 returning ${SELECT_COLUMNS}`,
    [id]
  );
  if (!rows.length) return null;

  const transaction = rowToTransaction(rows[0]);

  if (isCashSide(transaction.side)) {
    await assertCashNeverNegative(db);
    return { transaction, open: true };
  }

  const open = isPositionTrade(transaction) ? await recomputeHolding(db, transaction.symbol) : true;
  return { transaction, open };
}

/**
 * Sets both cash balances to the given figures by recording the difference
 * as a deposit or withdrawal today, so the history keeps every change.
 */
export async function setCashBalances(db: Db, target: CashBalances, occurredOn: string) {
  await ensureOpeningCash(db, occurredOn);
  const current = await getCashBalances(db);
  const written: HoldingTransaction[] = [];

  for (const currency of CASH_CURRENCIES) {
    const wanted = Number(target[currency]);
    if (!Number.isFinite(wanted) || wanted < 0) throw new Error(`${currency} balance must be zero or more`);

    const delta = roundTo(wanted - current[currency], 4);
    if (Math.abs(delta) < 0.005) continue;

    written.push(
      ...(await insertTransactions(db, [
        normalizeTransaction({
          side: delta > 0 ? "deposit" : "withdraw",
          quantity: Math.abs(delta),
          currency,
          occurredOn,
          note: ADJUSTMENT_NOTE
        })
      ]))
    );
  }

  await assertCashNeverNegative(db);
  return written;
}

/** Removing a position also drops its trades; otherwise the next trade would bring it back. */
export async function deletePositionTrades(db: Db, symbol: string) {
  const ids = (await positionTrades(db, symbol)).map((trade) => trade.id);
  if (ids.length) await db.query(`delete from holding_transactions where id = any($1::text[])`, [ids]);
  return ids.length;
}

/**
 * The fin-port sheet: one trade per row as symbol, side, price, quantity,
 * date -- no header, dates in Thai short form. A header row is tolerated.
 */
export function parseTradeSheet(csv: string): Array<Omit<HoldingTransaction, "id">> {
  return parseCsv(csv)
    .filter((cells) => Number.isFinite(Number(cells[2]?.replace(/,/g, ""))))
    .map((cells, index) => {
      const [symbol, side, price, quantity, date] = cells.map((cell) => cell.trim());
      try {
        return normalizeTransaction({
          symbol,
          side,
          price: Number(price.replace(/,/g, "")),
          quantity: Number(quantity.replace(/,/g, "")),
          currency: "USD",
          occurredOn: date,
          note: SHEET_IMPORT_NOTE
        });
      } catch (error) {
        throw new Error(`row ${index + 1} (${cells.join(", ")}): ${error instanceof Error ? error.message : error}`);
      }
    });
}

/**
 * Replaces every row a previous sheet import wrote with the sheet as it is
 * now, then rebuilds the affected holdings. Rows added through the app are
 * left alone. Re-running after correcting a row in the sheet fixes it in place.
 */
export async function importTradeSheet(db: Db, trades: Array<Omit<HoldingTransaction, "id">>) {
  const { rows: removed } = await db.query<{ symbol: string }>(
    `delete from holding_transactions where note = $1 returning symbol`,
    [SHEET_IMPORT_NOTE]
  );

  await insertTransactions(db, trades);

  const affected = new Map<string, string>();
  for (const { symbol } of [...removed, ...trades]) affected.set(symbolKey(symbol), symbol);

  const holdings: Array<{ symbol: string; open: boolean }> = [];
  for (const symbol of affected.values()) {
    holdings.push({ symbol, open: await recomputeHolding(db, symbol) });
  }

  return { removed: removed.length, inserted: trades.length, holdings };
}

function roundTo(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
