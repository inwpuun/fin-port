---
name: fin-port
description: Read and edit Puun's investment portfolio in fin-port — summarize holdings, prices, profit and net worth; record, fix or delete buy/sell trades; update cash; manage the watchlist. Use for any question about "พอร์ต", หุ้นที่ถือ, กำไร/ขาดทุน, ราคาหุ้น, net worth, or a trade to record.
version: 1.0.0
author: puunp
tags: [finance, portfolio, stocks]
---

# fin-port

fin-port is the portfolio tracker (Next.js + Postgres). It holds US stocks,
ETFs, gold (`GOLD`), bitcoin (`BTC`) and cash in USD and THB. Every change goes
through its HTTP API, called with the `finport` helper (installed at
`~/.local/bin/finport`; use that full path if `finport` is not found):

```sh
finport METHOD /api/path ['json body']
```

`finport` reads the URL and the passphrase from `~/.config/fin-port/env`.
Never print, echo or ask for the passphrase, and never put it in a command.
The helper prints the JSON response; on an HTTP error it exits 1 and the body
is `{"error": "..."}`. Read that message and tell the user what it says; it is
written to be shown as-is.

Answer in Thai unless the user writes in English. Money in baht is `฿12,345`,
in dollars `$1,234.56`; percentages to two decimals with a sign (`+3.25%`).

## Rules

1. **Read freely, confirm before writing.** Before any POST, PATCH or DELETE,
   show the user exactly what will be written (symbol, side, quantity, price,
   fee, currency, date) and wait for a yes. One confirmation covers one write.
2. **Never guess a trade.** If the quantity, price or date is missing, ask.
   "Today" means today's date in Asia/Bangkok. Dates are `YYYY-MM-DD`; the API
   also takes Thai `d/m/yy` in the Buddhist era (`3/10/69` = 2026-10-03).
   Future dates are rejected.
3. **Ids change on edit.** A PATCH returns the row with a new `transaction.id`;
   the old id stops existing. Always look up the current id before editing or
   deleting. Never reuse an id from earlier in the conversation without
   re-reading it.
4. After a write, re-read what changed (the holding or the summary) and report
   the new figure, not the one you expected.

## Read the portfolio

| Want | Call |
| --- | --- |
| Whole port, priced, in baht | `finport GET /api/portfolio/summary` |
| Same in dollars | `finport GET '/api/portfolio/summary?currency=USD'` |
| Some holdings only | `finport GET '/api/portfolio/summary?symbols=NVDA,BTC'` |
| Positions without prices (fast) | `finport GET /api/portfolio/holdings` |
| Last close of any symbol | `finport GET '/api/market/prices?symbols=AAPL,THB=X'` |
| Price, drawdown and signal of any symbol | `finport GET '/api/market/summary?symbols=TSLA'` |
| USD/THB reference rate (BOT) | `finport GET /api/exchange-rate/usd-thb` |
| Net worth per day since the first trade | `finport GET /api/portfolio/history` |
| Watchlist | `finport GET /api/watchlist/my-watchlist` |
| Allocation lanes | `finport GET /api/allocation` |
| Is the server healthy | `finport GET /api/health` |

`/api/portfolio/summary` returns:

- `totals`: `marketValue`, `costBasis`, `profitLoss`, `profitLossPercent`,
  `dayChange`, `dayChangePercent`, and for the whole port also `cash`,
  `netWorth` (holdings + cash) and `moneyIn` (cost + cash). All money is in
  `currency`.
- `holdings[]`, largest first: `symbol`, `name`, `category`, `quantity`,
  `averageCost` (in `costCurrency`), `price` and `previousClose` (in
  `priceCurrency`), `priceChangePercent`, `marketValue`, `costBasis`,
  `profitLoss`, `profitLossPercent`, `dayChange`, `weightPercent`,
  `drawdownPercent` (from the one-year high), `signal.label`/`signal.bias`.
- `fx`: the rates used. `errors`: symbols that could not be priced. They are
  left out of the totals, so always mention them.

Prices are the last daily close from Yahoo (cached a minute). During US
market hours that is the previous close; say so if the user asks for a "live"
price.

### Summarizing the port

When asked for a summary (สรุปพอร์ต), call the summary once and reply with:

```
💼 พอร์ต ณ <date>
มูลค่าสุทธิ ฿<netWorth> (หุ้น ฿<marketValue> + เงินสด ฿<cash>)
กำไรรวม <+฿profitLoss> (<+profitLossPercent>%)
วันนี้ <+฿dayChange> (<+dayChangePercent>%)

🟢/🔻 <SYMBOL> ฿<marketValue> · <+profitLossPercent>% · วันนี้ <+priceChangePercent>%
... (every holding, largest first; 🟢 for profit, 🔻 for loss)
```

Add a line for `errors` if not empty. For "หุ้นไหนกำไร/ขาดทุนมากสุด", sort
`holdings` by `profitLossPercent` or `profitLoss` yourself. For "ถือ X เท่าไร",
use the summary with `?symbols=X`.

## The trade log (CRUD)

A position is built from its trades: every buy/sell rebuilds that symbol's
holding (quantity and average cost). Cash is `deposit`/`withdraw` rows on the
`CASH` symbol.

Fields: `symbol`, `side` (`buy` `sell` `dividend` `fee` `deposit` `withdraw`),
`quantity` (shares, or the amount for cash), `price` (per unit), `fee`
(optional, total), `currency` (`USD` default; cash is `USD` or `THB`),
`occurredOn`, `note` (optional), `category` (optional allocation lane for a
first buy).

### List / find

```sh
finport GET '/api/portfolio/transactions?symbol=NVDA&limit=10'
finport GET '/api/portfolio/transactions?side=buy,sell&from=2026-10-01&to=2026-10-31'
finport GET '/api/portfolio/transactions?id=<id>'
```

Newest first. `total` is the count before `limit`. `symbol` matches every
spelling (`BRK.B` = `BRK-B`, `GOLD` = `GC=F`, `BTC` = `BTC-USD`).

### Create

```sh
finport POST /api/portfolio/transactions '{"symbol":"NVDA","side":"buy","quantity":0.5,"price":180.25,"fee":0,"currency":"USD","occurredOn":"2026-11-03"}'
finport POST /api/portfolio/transactions '{"symbol":"AMD","side":"buy","quantity":1,"price":160,"occurredOn":"2026-11-03","category":"Future Hardware"}'
finport POST /api/portfolio/transactions '{"side":"deposit","quantity":5000,"currency":"THB","occurredOn":"2026-11-03"}'
```

A sell larger than what was held on that date is rejected. Bitcoin bought in
baht is `"symbol":"BTC","currency":"THB"` with the baht price per 1 BTC; one
symbol cannot mix currencies.

### Update

Find the row, show it, confirm, then send only the fields that change:

```sh
finport PATCH '/api/portfolio/transactions?id=<id>' '{"price":182.10}'
finport PATCH '/api/portfolio/transactions?id=<id>' '{"quantity":0.6,"occurredOn":"2026-11-02"}'
finport PATCH '/api/portfolio/transactions?id=<id>' '{"symbol":"GOOGL"}'
```

Changing the symbol rebuilds both positions. An edit that would make a later
sell exceed what was held is rejected and nothing changes. The response has
`transaction` (new row, new id) and `previous` (the row as it was).

### Delete

```sh
finport DELETE '/api/portfolio/transactions?id=<id>'
```

The holding is rebuilt from the trades that remain; deleting the only buy
removes the holding.

## Cash

```sh
finport POST /api/portfolio/cash '{"usd":1300.28,"thb":51577.16,"occurredOn":"2026-11-03"}'
```

Sets both balances to these figures by recording the difference. Send both,
reading the current ones from `/api/portfolio/holdings` (`cash`) first. THB
cash is rebuilt from the cash book (Firefly III) whenever the book changes,
so a THB change here only lasts until the next sync; tell the user to record
baht spending in Firefly instead.

## Watchlist and allocation

```sh
finport POST /api/watchlist/my-watchlist '{"symbol":"AVGO"}'
finport DELETE '/api/watchlist/my-watchlist?symbol=AVGO'
finport POST /api/allocation '{"symbol":"NVDA","category":"AI"}'   # move a holding to another lane
```

## Things to avoid

- `DELETE /api/portfolio/my-port` removes a holding **and all of its trades**.
  Do not call it; delete individual transactions instead, unless the user
  explicitly asks to remove the whole position and confirms.
- Do not loop over many writes without showing the full list first.
- A 401 means the passphrase is wrong, or this host has failed 20 times in 10
  minutes and is locked out for the rest of that window. Do not retry in a
  loop; tell the user.
