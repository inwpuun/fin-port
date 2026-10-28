import { num, type Db } from "@/lib/db/sql";
import { fetchDailyCloses } from "@/lib/market";
import { CASH_SYMBOL, addTransaction, getCashBalances, isPositionTrade, listTransactions, symbolKey } from "@/lib/trades";

/**
 * Keeps the THB cash balance in step with the cash book.
 *
 * THB cash is every cash-book account except the ones whose money already
 * shows up as a position: Dime Invest (what was sent to the broker, now
 * stocks, gold and the USD cash there) and BTC (the BTC holding). USD cash is
 * not in the cash book, so its rows are left alone and stay hand-entered.
 *
 * Every THB row on CASH is rebuilt from the book on each import, as weekly
 * balance steps, so the net-worth chart follows the book without one row per
 * coffee.
 *
 * Until May 2025 the buys were paid for without a transfer into Dime Invest
 * being recorded, so the book still counted that money as cash next to the
 * stocks it bought. Whatever the trade log spent beyond what had reached Dime
 * Invest by that day is taken off the cash, which keeps those months from
 * counting the same money twice.
 */

export const INVEST_ACCOUNT = "Dime Invest";
export const EXCLUDED_ACCOUNTS = [INVEST_ACCOUNT, "BTC"];
export const CASH_BOOK_NOTE = "cash book";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CashSyncResult = { rows: number; thb: number; through: string | null };

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Running balance of each day, from the account's current balance backwards. */
function balanceOn(current: number, moves: Array<{ d: string; amount: number }>, day: string) {
  return moves.reduce((balance, move) => (move.d > day ? balance - move.amount : balance), current);
}

export async function syncCashFromBook(db: Db): Promise<CashSyncResult> {
  // One client inside a transaction: queries go one at a time.
  const { rows: accounts } = await db.query<{ name: string; current_balance: string | null }>(
    `select name, current_balance from cash_accounts`
  );
  const { rows: moves } = await db.query<{ account: string; d: string; amount: string }>(
    `select account, occurred_on::text as d, amount from cash_transactions`
  );
  const trades = await listTransactions(db);

  // THB rows are owned by the book from here on; USD rows are not touched.
  await db.query(`delete from holding_transactions where upper(symbol) = $1 and currency = 'THB'`, [CASH_SYMBOL]);

  const cashAccounts = accounts.filter((account) => !EXCLUDED_ACCOUNTS.includes(account.name));
  const invest = accounts.find((account) => account.name === INVEST_ACCOUNT);
  if (!cashAccounts.length) return { rows: 0, thb: 0, through: null };

  const cashNow = cashAccounts.reduce((sum, account) => sum + (num(account.current_balance) ?? 0), 0);
  const cashMoves = moves
    .filter((move) => !EXCLUDED_ACCOUNTS.includes(move.account))
    .map((move) => ({ d: move.d, amount: Number(move.amount) }));
  const investMoves = moves
    .filter((move) => move.account === INVEST_ACCOUNT)
    .map((move) => ({ d: move.d, amount: Number(move.amount) }));

  // Positions bought through Dime Invest: everything but an excluded account's own symbol (BTC).
  const excludedSymbols = new Set(EXCLUDED_ACCOUNTS.map(symbolKey));
  const buys = trades.filter((trade) => isPositionTrade(trade) && !excludedSymbols.has(symbolKey(trade.symbol)));

  const days = [...cashMoves, ...investMoves].map((move) => move.d).sort();
  // Start at the first trade or the first book entry, whichever is earlier.
  const first = [buys[0]?.occurredOn, days[0]].filter(Boolean).sort()[0]!;
  const through = days.at(-1)!;

  const fx = buys.some((trade) => trade.currency !== "THB")
    ? (await fetchDailyCloses("THB=X", addDays(first, -10))).closes
    : new Map<string, number>();
  const fxOn = (day: string) => {
    for (let probe = day; probe >= addDays(first, -10); probe = addDays(probe, -1)) {
      const rate = fx.get(probe);
      if (rate) return rate;
    }
    throw new Error(`No USD/THB rate on or before ${day}`);
  };

  const spent = buys.map((trade) => {
    const gross = trade.quantity * trade.price;
    const amount = trade.side === "sell" ? -(gross - trade.fee) : gross + trade.fee;
    return { d: trade.occurredOn, thb: trade.currency === "THB" ? amount : amount * fxOn(trade.occurredOn) };
  });
  const spentBy = (day: string) => spent.reduce((sum, item) => (item.d <= day ? sum + item.thb : sum), 0);
  const unrecordedBy = (day: string) =>
    Math.max(0, spentBy(day) - (invest ? balanceOn(num(invest.current_balance) ?? 0, investMoves, day) : 0));

  // Weekly steps, plus the days the uncounted spending moves, so a buy and the
  // cash that paid for it leave on the same day.
  const steps = new Set([first, through]);
  for (let day = first; day <= through; day = addDays(day, 1)) {
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) steps.add(day);
  }
  for (const item of spent) if (item.d <= through && unrecordedBy(item.d) > 0) steps.add(item.d);
  for (const move of investMoves) if (move.d <= through) steps.add(move.d);

  let thb = 0;
  let rows = 0;
  for (const day of [...steps].sort()) {
    // A card bill larger than the bank balance would read as negative cash; floor it.
    const target = Math.max(0, Math.round((balanceOn(cashNow, cashMoves, day) - unrecordedBy(day)) * 100) / 100);
    const delta = Math.round((target - thb) * 100) / 100;
    if (Math.abs(delta) < 0.01) continue;

    await addTransaction(db, {
      side: delta > 0 ? "deposit" : "withdraw",
      symbol: CASH_SYMBOL,
      quantity: Math.abs(delta),
      currency: "THB",
      occurredOn: day,
      note: CASH_BOOK_NOTE
    });
    thb = target;
    rows += 1;
  }

  return { rows, thb: (await getCashBalances(db)).THB, through };
}

export function describeCashSync(result: CashSyncResult) {
  if (!result.through) return "Cash: no cash-book accounts, THB cash left as it was.";
  const thb = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(result.thb);
  return `Cash: THB balance is now ${thb} as of ${result.through} (${result.rows} weekly steps rebuilt; USD cash unchanged).`;
}
