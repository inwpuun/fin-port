---
name: fin-port
description: Read and edit Puun's investment portfolio in fin-port through the `finport__*` MCP tools — summarize holdings, prices, profit and net worth; record, fix or delete buy/sell trades; update cash; manage the watchlist. Use for any question about พอร์ต, หุ้นที่ถือ, กำไร/ขาดทุน, ราคาหุ้น, ทอง, BTC, net worth, or a trade to record.
version: 2.0.0
author: puunp
tags: [finance, portfolio, stocks]
---

# fin-port

fin-port is the investment tracker: US stocks and ETFs, gold (`GOLD`),
bitcoin (`BTC`, bought in baht) and cash in USD and THB. Reach it only through
the `finport__*` MCP tools. Don't call its HTTP API with the shell.

fin-port is **not** Firefly. Firefly (`firefly__*`) is the daily spending
ledger in baht. fin-port is investments. "ซื้อ NVDA" goes to fin-port, and
"ข้าวเที่ยง 120" goes to Firefly. Baht cash in fin-port is rebuilt from
Firefly, so record baht spending in Firefly, never as a fin-port withdrawal.

Answer in Thai unless the user writes in English. Write baht as `฿12,345`,
dollars as `$1,234.56`, and percentages with a sign and two decimals (`+3.25%`).

## Rules

1. **Read freely. Confirm before writing.** Before `record_transaction`,
   `update_transaction`, `delete_transaction`, `set_cash_balances` or
   `set_allocation`, show exactly what will be written (symbol, side,
   quantity, price, fee, currency, date) and wait for a yes. One yes covers
   one write. If several trades are given at once, list them all first and
   then write them one by one.
2. **Never guess a trade.** If the quantity, price or date is missing, ask.
   "Today" is today in Asia/Bangkok. Dates are `YYYY-MM-DD`. Thai `d/m/yy` in
   the Buddhist era also works (`3/10/69` = 2026-10-03). Future dates are
   rejected.
3. **Ids change on edit.** `update_transaction` returns the row with a NEW
   `transaction.id`, and the old id stops existing. Always look up the id with
   `list_transactions` right before editing or deleting. Never reuse an id from
   earlier in the conversation.
4. **Report what the tool returned.** It returns the new holding. Say that
   figure, not the one you expected. A tool error is a plain sentence written
   for the user (for example "Cannot sell 10 NVDA on 2026-11-02: only 5.03
   held then"). Pass it on and ask how to proceed. Don't retry the same call.

## Tools

| Need | Tool |
| --- | --- |
| Whole port, priced (default THB) | `get_portfolio_summary` (`currency: "USD"` for dollars) |
| One or a few holdings, priced | `get_portfolio_summary` with `symbols` |
| Positions, average cost, cash, no prices | `list_holdings` |
| Net worth over time | `get_net_worth_history` (`every`: day / week / month, `from`) |
| Trades | `list_transactions` (`symbol`, `sides`, `from`, `to`, `limit`, or `id`) |
| Record a buy/sell/dividend/fee or a cash deposit/withdraw | `record_transaction` |
| Fix a trade | `update_transaction` (id + only the fields that change) |
| Remove a trade | `delete_transaction` |
| Set cash totals | `set_cash_balances` (send both usd and thb) |
| Price of anything | `get_prices` (`THB=X` = baht per dollar) |
| Trend, drawdown, verdict for a symbol | `get_market_analysis` |
| BOT USD/THB rate | `get_usd_thb_rate` |
| Watchlist | `list_watchlist`, `add_to_watchlist`, `remove_from_watchlist` |
| Allocation lanes | `list_allocation`, `set_allocation` |

Prices are the last daily close from Yahoo. While the US market is open,
that is still yesterday's close. Say so if the user asks for a live price.

## Recipes

### สรุปพอร์ต

Call `get_portfolio_summary` once and reply in this shape:

```
💼 พอร์ต ณ <d MMM yyyy>
มูลค่าสุทธิ ฿<netWorth>  (หุ้น ฿<marketValue> + เงินสด ฿<cash>)
กำไรรวม <+฿profitLoss> (<+profitLossPercent>%)
วันนี้ <+฿dayChange> (<+dayChangePercent>%)

🟢 VOO ฿68,983 · +16.83% · วันนี้ +0.54%
🔻 XYZ ฿1,234 · -4.10% · วันนี้ -1.20%
…every holding, largest first. 🟢 = in profit, 🔻 = at a loss.
```

If `errors` is not empty, add a line naming those symbols: they are left out
of the totals. For "ตัวไหนกำไร/ขาดทุนมากสุด", sort `holdings` yourself by
`profitLossPercent` (or by `profitLoss` for money). For "สัดส่วน/allocation",
group `holdings` by `category` and add up `weightPercent`.

### ถือ X เท่าไร / X ตอนนี้เท่าไร

Call `get_portfolio_summary` with `symbols: ["X"]`. Report the quantity,
average cost, price, value and P/L. If X is not held, use `get_prices`.

### ซื้อ/ขาย (record a trade)

"ซื้อ NVDA 0.5 หุ้น ที่ 180.25 เมื่อวาน ค่าธรรมเนียม 0.1" →
`record_transaction` `{ side: "buy", symbol: "NVDA", quantity: 0.5, price: 180.25, fee: 0.1, occurredOn: "<yesterday>" }`.
When the user gives an amount instead of shares ("ซื้อ NVDA 100 ดอลลาร์ ที่
180"), quantity = amount / price, rounded to 7 decimals. Show it before
writing. For a symbol with no holding yet, ask for a lane (`category`) or
offer the closest one from `list_allocation`.
BTC trades are in baht: `currency: "THB"`, price = baht per 1 BTC.

### แก้/ลบรายการ

1. `list_transactions` with `symbol` and a date range to find the row.
2. Show the row and the change, and get a yes.
3. `update_transaction` with the id and only the changed fields, or
   `delete_transaction`.
4. Report the holding from the result.

## Don't

- Don't record baht spending or income in fin-port. That belongs in Firefly.
- Don't use the shell or curl for fin-port.
- Don't delete a whole position by deleting its trades in a loop unless the
  user asks for exactly that and has seen the list.
