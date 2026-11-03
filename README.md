# Fin Port

Next.js financial dashboard for US stocks, gold, bitcoin, indices, a personal
portfolio, and a Thai-baht cash ledger. Data lives in a Postgres that runs
beside the app in `docker-compose.yml`. The cash ledger is copied from
[Firefly III](https://www.firefly-iii.org/), which is where transactions are
entered; the other CSVs are only a seed format.

## Run

Everything, in two containers:

```bash
cp .env.example .env         # fill in POSTGRES_PASSWORD and ADMIN_TOKEN
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose up -d --build
```

The database creates its schema on first start, so there is nothing to run
against an empty volume. Then import your data — see Setup.

To work on the app itself, run Next.js on the host against the same database:

```bash
docker compose up -d db      # Postgres only, published on 127.0.0.1:5432
npm install
npm run dev
```

Open `http://localhost:3000` and unlock with your `ADMIN_TOKEN`.

## Pages

- `/` market watch with a TradingView-style chart readable through three lenses, a metrics panel per lens, a composite read, and the watchlist
- `/portfolio` holdings tracker with calculated buy price, quantity, live market value, total net worth, P/L, drawdown flags, a net-worth-over-time chart, and the trade log
- `/watchlist` watchlist tracker with live prices, one-year moves, drawdown flags, and a signal column
- `/allocation` allocation chart and category table
- `/cash-book` ledger with per-year overview, category and description breakdowns, graphs, transaction modals, and a Firefly III sync
- `/unlock` passphrase gate

## Allocation follows the portfolio

A symbol needs an `allocations` row to appear in a lane, and the allocation
page builds its lanes from those rows. A holding with no row therefore used to
contribute nothing: it counted towards net worth on `/portfolio` while the
allocation total silently ignored it, so the two pages disagreed.

Saving through the holding editor sets a category, so that path stays
consistent. The holding-value + % profit form does not ask for one, and neither
does `npm run db:seed`, so `/allocation` now gathers any holding without a rule
into an explicit **Unassigned** lane, counts it in the total, and names the
symbols so they can be filed. Deleting a holding clears its lane too, so the
reverse — a lane pointing at nothing — is reported as "in an allocation lane
but not held".

## The "Updated" label

Every page shows, next to the logo, when the data behind *that page* was last
written. It reads `updated_at`, which each table defaults on insert and bumps
through the `touch_updated_at` trigger on update:

| Page | Reads |
| --- | --- |
| `/` and `/watchlist` | `watchlist` |
| `/portfolio` and `/allocation` | the later of `holdings` and `allocations` |
| `/cash-book` | the latest transaction edit in Firefly III |

Because the seed importer upserts, re-importing an unchanged CSV still moves
the timestamp — the label answers "when was this data last written", not "when
did a value last differ". `/cash-book` has no table: its label is the latest
`updated_at` among Firefly's transactions, read from memory. The absolute time renders first and is pinned to
Asia/Bangkok so the server and client produce the same string; the relative
form ("3 hrs ago") replaces it after mount and refreshes each minute. The
lookup is skipped entirely without a valid session, so `/unlock` never queries
the database.

## Security model

No database credential ever reaches a browser.

- No environment variable is named `NEXT_PUBLIC_*`. Next.js inlines any
  `NEXT_PUBLIC_` value into the client bundle, which publishes it to every
  visitor. `DATABASE_URL` contains a password; every query runs in a Server
  Component or Route Handler.
- `src/lib/env.ts`, `src/lib/db/client.ts` and the data libs import
  `server-only`, so importing them from a Client Component fails the build
  instead of leaking at runtime.
- **The network is the boundary.** Postgres answers only on the Compose
  network and on `127.0.0.1:5432`; it is never published to the LAN. There is
  no second, lower-privilege client to defend against, which is why the schema
  defines no row-level policies — with a hosted database and a browser-facing
  key they were load-bearing, here they would be theatre. Drop the `ports:`
  block on the `db` service to close even the loopback port; only the host-side
  `npm run dev`, `npm run db:migrate` and `psql` need it.
- `proxy.ts` puts the whole site behind a passphrase, so exposing port 3000 is
  not a public window onto your finances.
- `proxy.ts` lets `/api/*` through so the CLI can authenticate with a bearer
  token instead, so **every API route checks authorization itself** -- reads
  included, not only writes. A GET that returns your watchlist is still your
  data, and the market and FX routes are gated too so nobody can use the
  deployment as a free proxy or spend your Bank of Thailand quota.
- Never use a real portfolio number as a placeholder or default in a Client
  Component: those strings are compiled into `.next/static`, which is served
  without the passphrase so the unlock page can boot.

Verify the bundle after any change:

```sh
npm run build
grep -r "postgres://\|DATABASE_URL\|ADMIN_TOKEN" .next/static   # must find nothing
```

## Setup

### 1. Configure environment

Copy `.env.example` to `.env` and fill it in. **Docker Compose reads `.env`**,
not `.env.local`, because it needs the `POSTGRES_*` values to interpolate into
`docker-compose.yml`; the same file is then handed to the app container, and
Next.js and the CLI scripts read it too. `.env.local` still wins over `.env`
wherever both set a name, so keep personal overrides there.

| Variable | Value | Used for |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_DB` | `finport` is fine | names the role and database Compose creates |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | set before the first `up`; changing it later needs the volume recreated |
| `POSTGRES_PORT` | `5432` | host port, if something else already holds 5432 |
| `DATABASE_URL` | `postgres://finport:<password>@localhost:5432/finport` | how the **host** connects. Compose overrides it for the app container with `@db:5432` |
| `ADMIN_TOKEN` | `openssl rand -hex 32` | unlock passphrase and the API bearer token |
| `FIREFLY_URL` / `FIREFLY_TOKEN` | Firefly base URL and a personal access token | source of the cash book (see Cash book from Firefly III) |
| `FIREFLY_REFRESH_MINUTES` | default `2` | how old the in-memory cash book may get before it is re-read in the background |
| `BOT_API_KEY` | Bank of Thailand developer portal | USD/THB reference rate for THB display |

### 2. Create the schema

Nothing to do on a fresh volume: `docker-compose.yml` mounts `db/migrations/`
at `/docker-entrypoint-initdb.d`, so Postgres applies them in filename order
the first time it initialises.

For a database that already exists — or to apply a migration added later:

```sh
npm run db:migrate          # apply everything not yet applied
npm run db:migrate -- --list
```

Each file runs in its own transaction and is recorded in `schema_migrations`.
Every migration is written to be idempotent (`create ... if not exists`,
`create or replace`), because the initdb path does not write that ledger and
the first `db:migrate` will therefore re-apply what initdb already ran. Keep
new migrations idempotent for the same reason.

### 3. Import the CSVs

Source files live in `data/` — deliberately **not** `public/`, because anything
in `public/` is served to the world at `https://<your-app>/my-port.csv`.

```
data/my-port.csv
data/my-allocation.csv
data/my-watchlist.csv
```

```sh
npm run db:seed        # holdings, allocations, watchlist
npm run db:import      # the same
npm run cash:rebuild   # rebuild THB cash from the cash book in Firefly III
```

Each run is one transaction: a file that fails validation halfway through
leaves the tables as they were rather than partly rewritten.

### Coming from Supabase

If this app already has data in a hosted Supabase project, copy it across
instead of re-seeding from CSV — the CSVs are stale the moment you edit a
holding in the browser.

Put the old project's credentials back in `.env.local` for one run:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

then:

```sh
npm run db:migrate                     # schema first
npm run db:from-supabase -- --dry-run  # row counts, writes nothing
npm run db:from-supabase               # copy every table
npm run db:from-supabase -- holdings   # or just named tables
```

It reads over Supabase's REST API — no SDK, no database password for the old
project — and writes each table in one transaction, upserting on that table's
natural key. An interrupted run can simply be repeated. `created_at` and
`updated_at` come across verbatim on insert, so the "Updated" label keeps
telling the truth about when data was last written.

Tables are copied parents-first (`alert_rules` before `alert_events`). A table
Supabase does not have is skipped, and a column it has that this schema does
not is dropped and named in the output rather than failing the table.

Delete `.env.local` once `/api/health` reports the row counts you expect. A
deleted Supabase project stops resolving in DNS entirely, and the script says
so rather than reporting `fetch failed`.

## Storage

| Table | Source | Natural key |
| --- | --- | --- |
| `holdings` | `data/my-port.csv` | `symbol` |
| `allocations` | `data/my-allocation.csv` | `(category, symbol)` |
| `watchlist` | `data/my-watchlist.csv` | `symbol` |

`src/lib/my-port.ts`, `src/lib/my-watchlist.ts` and `src/lib/cash-book.ts` keep
the same exported functions they had when they read CSV files, so the pages and
components above them are unchanged — only the backing store moved. The cash
book has no table at all: it is read from Firefly III.

The full schema is `db/migrations/`. Beyond the five tables above it also
defines `fx_rates`, `portfolio_snapshots`, `holding_transactions`,
`alert_rules` and `alert_events`, which the app does not read yet; they are
carried across by the Supabase migration and are there for the history,
trade-log and alerting work.

Postgres is the single source of truth, and no page caches rows in the browser.
The portfolio dashboard used to keep holdings in `localStorage` under
`fin-port-holdings-v3` and read that cache *before* the server data, returning
early when it found one. That made sense when the CSV was a read-only seed and
edits lived only in the browser, but with a real database it shadowed the
truth: an empty array is truthy once serialized, so opening the app once before
the import stored `"[]"` and every later visit short-circuited on it and never
queried again. Because `localStorage` is per-origin, a poisoned
deployment showed an empty table while `localhost` looked correct, and
`/allocation` — which reads the very same holdings without caching — was fine.
Don't reintroduce a client-side cache for rows the database owns.

The move off CSV is also what lets the image run with a read-only filesystem.
The CSV version wrote back to `public/*.csv` with `writeFile`, so Docker
Compose had to bind-mount `./public`. That bind mount is gone.

`my-port.csv` accepts either `holding value` + `% profit`, or `quantity` +
`cost basis` + `cost currency` for positions such as bitcoin bought in THB.
Cost basis is the **total** paid, not a unit price.

## Transactions and cash

Positions change through trades. **Buy / sell** on `/portfolio` or
`/allocation` (or **Trade** on a holdings row) records a buy or sell with its
quantity, unit price, optional fee and date into `holding_transactions`. That
symbol's `holdings` row is then rebuilt by replaying all of its trades in date
order. A sell removes its share of the cost at the average price, so the buy
price shown on the table is unchanged by selling. A sell larger than what was
held on that date is rejected, and so is mixing USD and THB trades on one
symbol. A sell that closes the position removes the holding and its lane.

The first trade on a symbol that already has a hand-entered holding (GOLD, BTC)
first copies that holding into the log as an `opening balance` buy at its
average cost. Without that step the new trade would replace the holding.
Delete the opening row and record the real buys if you have them.

Cash is two balances, USD and THB, stored in the same log as `deposit` and
`withdraw` rows on the `CASH` symbol. **Update cash** takes both balances as
they stand and records only the difference, dated, so the history knows when
money arrived. The old single `cash value` on the `CASH` allocation row becomes
the opening deposit the first time cash is changed.

**THB cash follows the cash book.** Whenever the book in Firefly changes (seen
by the background refresh, **Refresh**, the API or `npm run cash:rebuild`), all
THB rows on `CASH` are rebuilt from it
(`src/lib/cash-book/sync-cash.ts`):

- THB cash is the sum of every account except `Dime Invest` and `BTC`, whose
  money already shows as positions. Card debt (Ktc) counts against it.
- It is written as weekly balance steps (note `cash book`), through the last
  day in the book or today, whichever is earlier: a future-dated row (a card
  bill booked ahead) counts from its own day. The rebuild runs whenever the
  book changes, and once a day regardless.
- Until May 2025 buys were paid for without a recorded transfer into Dime
  Invest, so on each day whatever the trade log had spent beyond the Dime
  Invest balance (at that day's USD/THB) is taken off the cash. Without it
  that money counts twice, as cash and as the stocks it bought.
- USD cash is not in the book. Its rows are never touched; keep it current
  with **Update cash**. A THB change made there lasts until the next sync that
  changes the book.

If the rebuild fails (it needs Yahoo's USD/THB history) the refresh result says
why cash was not updated, and the next refresh tries again.

Net Worth on `/portfolio` includes cash; Money In is cost basis plus cash.

To fix a mistyped trade, delete it in the **Transactions** table and record
it again; the position is rebuilt from what remains.

### Importing the trade sheet

The `fin-port` sheet has one trade per row: `symbol, side, price, quantity,
date`, with Thai short dates (`3/10/69` = 3 Oct 2026). Import it with:

```sh
npm run db:trades -- "https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=fin-port" --dry-run
npm run db:trades -- "https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=fin-port"
```

`--dry-run` prints each affected holding before and after, then rolls back.
Every row an earlier import wrote (note `sheet import`) is replaced, so
correcting the sheet and re-running fixes it in place; trades added in the app
are kept. Selling "everything" may come out a unit in the 7th decimal above
the sum of the buys, because brokers round each fill separately. A sell within
1e-6 of the position is treated as closing it.

## Net worth over time

`/api/portfolio/history` replays the trade log day by day against Yahoo daily
closes and the USD/THB rate (`THB=X`). Nothing is stored, so a corrected trade
redraws the whole curve. The chart draws two lines: net worth (holdings plus
cash) and money in (cost basis plus cash). The gap between them is profit, and
hovering a day shows all three. Profit % is measured against cost only, as on
the Total P/L card. In THB, each day converts at that day's rate.

Yahoo's closes are split-adjusted, but the log records what was actually
traded, so each close is scaled back to that day's real price (NVDA traded at
$795 before its 10:1 split in June 2024, not the adjusted $79).

A holding with no trades has no history to replay. It enters the chart at
cost on the day its row was created, which shows as a step in both lines, and
the chart names it. Record its real buys to remove the step.

## Editing a position

`/portfolio` and `/allocation` share one editor (`holding-editor-modal.tsx`),
opened from the **Edit** button on any row of either page. For a symbol with
trades it changes only the allocation lane; the quantity comes from the log.

It takes a quantity and a per-unit buy price and stores their product as the
cost basis, alongside the allocation category. Entering the position this way
needs no market quote, so it works for assets priced in THB — the holding
value + % profit form still requires a USD quote to derive a quantity, and says
so if the symbol returns another currency.

A symbol belongs to exactly one lane. Because `allocations` is keyed on
`(category, symbol)`, moving a symbol deletes its previous row first; otherwise
it would be counted in two lanes and inflate the total. Deleting a holding also
clears its lane, so no symbol is left behind with no value against it.

The `CASH` row opens the cash form instead (see Transactions and cash).

## Cash book from Firefly III

Transactions are entered in Firefly III (by hand, or through an agent using
its API). fin-port reads them from Firefly's API; there is no copy in Postgres.

- **Read, mapped, kept in memory** (`src/lib/cash-book/firefly-book.ts`). A full
  read of ~3k transactions takes ~3 s on a Raspberry Pi, so the last read is
  held in memory (~2 MB) and served at once. When it is older than
  `FIREFLY_REFRESH_MINUTES` (default 2) the next request still gets it and a
  re-read starts in the background; a timer re-reads on the same interval, so
  pages only wait on the first read after a restart. **Refresh** on
  `/cash-book` re-reads immediately.
- **If Firefly is down**, the last read keeps being served; after a restart with
  Firefly down the cash book is empty until it is back.
- **Same shape as the MoneyWiz export it replaced** (`firefly-map.ts`). An
  expense or income is one row on its asset account; a transfer is two, out of
  the source and into the destination. The destination row reads
  `Transfer from <source>` when the source reads `Transfer to …`, and takes its
  date from Firefly's `process_date` when set (MoneyWiz let the two sides carry
  different times). `Parent ► Child` categories split into category and
  subcategory; tags are written `A; B; `. Opening balances are not rows; each
  account's balance is its opening balance plus every row, future-dated ones
  included.
- Ids are `ff:<journal id>:src|dst`.
- **Transfers are excluded from income and expense.** A move from K-bank to Dime Invest writes a debit and a credit; counting both reports the same baht twice. `getCashBookTransactions()` filters them out.

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-app>/api/cash-book/refresh
```

When Firefly runs in another Compose project on the same host, point the app
at it through the host: `FIREFLY_URL=http://host.docker.internal:<port>`
(`docker-compose.yml` maps that name to the host gateway).

## API

Every route requires a session cookie or `Authorization: Bearer $ADMIN_TOKEN`.
Nothing but `/unlock` and static assets answers without one.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/market?symbol=&range=&drawdownRange=&overlays=` | quotes, candles and analytics |
| `GET` | `/api/market/summary?symbols=A,B,C&drawdownRange=` | market data without candles for many symbols in one request (cached a minute); `/portfolio` uses it |
| `GET` | `/api/market/prices?symbols=A,B,C` | last close for many symbols in one request (cached a minute); `/allocation` uses it |
| `GET` | `/api/exchange-rate/usd-thb` | BOT reference rate |
| `GET` `POST` `DELETE` | `/api/watchlist/my-watchlist` | saved symbols |
| `POST` `DELETE` | `/api/portfolio/my-port` | required | upsert or remove a holding, and its allocation lane (remove also deletes its trades) |
| `GET` | `/api/portfolio/holdings` | open positions with quantity, cost, average cost, lane and trade count, plus cash; no market calls |
| `GET` | `/api/portfolio/summary?currency=THB\|USD&symbols=` | the portfolio priced at the last close: per-holding value, P/L, day change, weight, drawdown, signal; totals with cash and net worth |
| `GET` `POST` `PATCH` `DELETE` | `/api/portfolio/transactions` | list (filters: `?id=`, `?symbol=`, `?side=buy,sell`, `?from=&to=`, `?limit=`), record (`side`: buy, sell, dividend, fee, deposit, withdraw), edit (`?id=` + the fields that change) or delete (`?id=`) a transaction |
| `POST` | `/api/portfolio/cash` | required | set the USD and THB cash balances |
| `GET` | `/api/portfolio/history` | required | daily net worth and money in since the first trade |
| `GET` `POST` `DELETE` | `/api/allocation` | required | move a symbol between lanes, edit the cash balance |
| `POST` | `/api/cash-book/refresh` | required | re-read the cash book from Firefly III now |

Editing a transaction gives it a new id, because ids are content hashes; the
response carries the new row as `transaction` and the old one as `previous`.
The row keeps its `created_at`, so it stays in place among same-day trades.
Both the old and the new position are rebuilt, and an edit that would make a
later sell exceed what was held is rolled back whole.

`/api/portfolio/summary` values the portfolio the way `/portfolio` does, so
the two agree: THB amounts convert to USD at Yahoo's `THB=X`, and the baht
figures use the Bank of Thailand rate (falling back to `THB=X`). A symbol
Yahoo cannot price is named in `errors` and left out of the totals. With
`?symbols=` the totals cover only those holdings and leave cash out.

Only *failed* bearer attempts count against the limit (20 per 10 minutes per
client), so an agent with the right token can call as often as it needs.

### MCP, and the ZeroClaw agent

`/api/mcp` serves the same API as an [MCP](https://modelcontextprotocol.io)
server (Streamable HTTP, stateless, JSON responses) behind the same bearer
token. Each tool calls the REST handler above with the caller's headers, so
validation cannot drift; writes return only the row and the holding they
touched instead of the whole log.

| Tool | REST |
| --- | --- |
| `get_portfolio_summary`, `list_holdings`, `get_net_worth_history` (sampled by day/week/month) | `/api/portfolio/summary`, `/holdings`, `/history` |
| `list_transactions`, `record_transaction`, `update_transaction`, `delete_transaction` | `/api/portfolio/transactions` |
| `set_cash_balances` | `/api/portfolio/cash` |
| `get_prices`, `get_market_analysis`, `get_usd_thb_rate` | `/api/market/prices`, `/api/market/summary`, `/api/exchange-rate/usd-thb` |
| `list_watchlist`, `add_to_watchlist`, `remove_from_watchlist` | `/api/watchlist/my-watchlist` |
| `list_allocation`, `set_allocation` | `/api/allocation` |

The [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw) agent on the Pi
(`luna`) uses it as an MCP server, because its sandboxed shell treats `curl`
as a high-risk command. `zeroclaw/fin-port/SKILL.md` is its skill: when to
use which tool, the confirm-before-write rules, and the Thai summary format.
On the Pi, in `~/.zeroclaw/config.toml`:

```toml
[[mcp.servers]]
name = "finport"
transport = "http"
url = "http://127.0.0.1:3000/api/mcp"
tool_timeout_secs = 60

[mcp.servers.headers]
Authorization = "Bearer <ADMIN_TOKEN>"

[mcp_bundles.portfolio]
servers = ["finport"]
```

then add `"portfolio"` to `agents.luna.mcp_bundles`, add
`finport__delete_transaction` and `finport__remove_from_watchlist` to the risk
profile's `always_ask`, and the read-only tools (`finport__get_portfolio_summary`,
`list_holdings`, `get_net_worth_history`, `list_transactions`, `get_prices`,
`get_market_analysis`, `get_usd_thb_rate`, `list_watchlist`, `list_allocation`,
each with the `finport__` prefix) to its `auto_approve` -- under
`level = "supervised"` every MCP call not listed there waits for a click on
Discord, copy the skill into
`~/.zeroclaw/agents/luna/workspace/skills/fin-port/`, and
`systemctl --user restart zeroclaw`.

## Diagnosing a deployment

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-app>/api/health
```

Reports whether Postgres is reachable, its server version, which migrations
are applied, a row count per table, which variables are *present* (never their
values), and warnings for a value pasted with stray whitespace.

This exists because a bad credential used to be almost invisible. The data libs
swallow errors so pages still render, so a wrong connection string looked like
"the holdings table is broken" while the watchlist quietly showed six hardcoded
starter symbols and appeared healthy. Every table was failing. The watchlist no
longer substitutes that list on an error -- only on a genuinely empty table --
and `/api/health` answers the question directly.

A database that answers but reports `"migrations": "none applied"` is the one
failure row counts alone cannot explain: it is up, it is just empty.

If `database` is `reachable` with the right row counts but `/portfolio` is
still empty while `/allocation` shows the same holdings correctly, it is not a
data problem — see the note below on the removed localStorage cache. Hard
refresh once; the current build clears the stale key itself.

If `database` is `unreachable`, the reported `error` carries the Postgres
SQLSTATE, which names the problem outright: `28P01` is a wrong password,
`3D000` a database that does not exist, `42P01` a table migrations never
created, `ECONNREFUSED` a database that is not running. Then check in order:

1. **Is the host right for where the app is running?** Inside Compose it must
   be `db`; from `npm run dev` on your machine it is `127.0.0.1`. Compose sets
   the container's `DATABASE_URL` itself for exactly this reason.
2. Is the database up and past its healthcheck? `docker compose ps`.
3. Does `POSTGRES_PASSWORD` still match the one in `DATABASE_URL`? Changing
   `POSTGRES_PASSWORD` after the first `up` does **not** change the role's
   password — the volume already has it. Either `ALTER ROLE` by hand, or
   recreate the volume and re-import.
4. Any trailing newline or space from pasting? The `warnings` field flags it.

## Deploying

The unit of deployment is the Compose stack, so a server needs Docker, this
repo and a filled-in `.env`:

```bash
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose up -d --build
```

`.gitignore` excludes `.env*` and all of `data/`, so no credential and no
financial data is committed; `.dockerignore` keeps both out of every image
layer.

Two things the app no longer does for you, now that the database is yours:

- **Back it up.** `docker compose exec db pg_dump -U finport finport | gzip > finport-$(date +%F).sql.gz`, on a schedule. The `pgdata` volume is the only copy of your ledger, and `docker compose down -v` deletes it.
- **Put TLS in front of it** if the host is reachable from anywhere but
  localhost. The passphrase gate protects the pages, not the wire.

Seed a deployment by pointing `DATABASE_URL` at it and running
`npm run db:import`; the cash book arrives on its own from Firefly.

### Passphrase hardening

`ADMIN_TOKEN` is the whole gate, so:

- **Generate it, don't invent it.** `openssl rand -hex 32` gives 256 bits;
  brute force is not a threat at that size. The app refuses to serve at all
  (503 on every page and API) if the token is under 24 characters, rather than
  pretending to be protected.
- **Failed attempts are rate limited** — 10 per 10 minutes on `/unlock`, 20 on
  bearer-token API calls, keyed by client IP. State is per app process, so this
  is defence in depth, not a hard global cap; put a reverse proxy's rate limiter
  in front of `/unlock` if you want one. A valid session cookie is checked
  before the limiter, so normal browsing can never throttle itself.
- **The cookie is not signed with the passphrase directly.** The signing key is
  `HMAC(ADMIN_TOKEN, "fin-port/session/v1")`, so the typed secret and the MAC
  key are separate values.
- **Comparisons run over SHA-256 digests**, which are fixed length, so neither
  the passphrase check nor the cookie check leaks the length of the input.
- **`?next=` is parsed, not pattern-matched.** A "starts with `/` but not `//`"
  check is not enough: URL parsers fold `\` into `/` and strip tabs, so
  `/\evil.com` and `/<tab>/evil.com` used to escape the origin and could be
  used to phish the passphrase with a genuine-looking link.

Sessions last 30 days and cannot be revoked individually — the payload is only
an expiry, with no session id. Changing `ADMIN_TOKEN` invalidates every
existing cookie at once, which is the revocation mechanism.

### Rotating a credential

The database password lives in the volume, so changing `POSTGRES_PASSWORD` in
`.env` alone does nothing:

```sh
docker compose exec db psql -U finport -c "alter role finport with password 'new-one';"
# then update POSTGRES_PASSWORD and DATABASE_URL in .env
docker compose up -d
```

To change the passphrase, update `ADMIN_TOKEN`; existing sessions stop
validating immediately, since the cookie is signed with it.

## Symbols

`AAPL`, `MSFT`, `NVDA` for US stocks; `GC=F` or `GOLD` for gold futures;
`BTC-USD` or `BTC` for bitcoin; `^GSPC`, `^IXIC`, `^DJI`, `^NDX` for indices.
`BRK.B` maps to `BRK-B` automatically.

## Reading the chart

Every chart -- the market page and the symbol modal on `/portfolio` and
`/watchlist` -- can be read through three lenses, switched with the
**Summary / Trend / Value** control (Summary is the default, on candles). Each one changes what is plotted, adds its own
lower pane, and swaps the metrics panel beside it:

| Lens | Chart | Answers |
| --- | --- | --- |
| **Trend** | 50/200-day averages, golden and death crosses marked, lower pane of % from the 200-day average | Is this in an up regime? |
| **Summary** | Regression trend from the window's high to its low (or low to high) with +/-2 std dev edges, plus CDC ActionZone V3 2020 (EMA 12/26, bars coloured by zone, BUY/SELL marks) | Where is the move heading, and which zone is today in? The panel also carries the drawdown and volatility figures |
| **Value** | Least-squares fit of log price with +/-1 and +/-2 sigma bands, lower pane of sigma from trend | Is the price stretched against its own trend? |

Ranges run 1M, 3M, 6M, 1Y, 2Y, 5Y. The chart opens on that range but plots
every bar loaded, so zooming out shows the warm-up history too; the fits (the
regression trend, the value channel) stay computed on the range picked. If the
provider fails, a chart retries three times with backoff before falling back to
demo data. The legend sits behind the "i" in the chart's corner. The axis defaults to logarithmic so
equal percentage moves get equal height. Each lens panel carries a "how it is
traded" line, and the composite panel weights the three (45% trend, 35% value,
20% risk) into one label, listing the five facts that produced it.

**[docs/chart-methods.md](docs/chart-methods.md)** has the full write-up: what
each statistic is, the published work behind it, how it is computed here, where
it fails, what was deliberately left out, and why the composite is a weighted
read of the evidence rather than a backtest.

To check the math without a browser:

```sh
npm run check:analytics        # synthetic series with known answers
npm run check:analytics NVDA   # and a live symbol at 6mo, 1y and 5y
```

### Warm-up, and why a payload is what it is

A 200-day average and twelve-month momentum are undefined on the first bar of a
six-month window, so every request loads roughly 14 extra months of history and
returns only the range asked for. A 5Y chart pulls ten years from the provider.
`analytics.bars` and `analytics.historyBars` report both counts, and the chart
footer shows them.

Per-bar overlays cost real bytes over a five-year window, so only what cannot be
recomputed from the candles is sent: the warm-up bars before the window
(`overlays.lead`) and the two averages over all of them. CDC ActionZone and the
regression trend are computed in the browser from those bars. The regression channel and the z-score line are drawn from
the three numbers in `analytics.value.logFit`, and a route only pays for
overlays if it asks with `overlays=1` -- the tables do not.

### LINE alerts for buy/sell signals

`/` used to raise browser notifications, which only fired while a tab was open.
The server now does the watching instead: every
`SIGNAL_ALERT_INTERVAL_MINUTES` (default 30) it loads each watchlist symbol on
the Summary lens's default range (1Y, warm-up included) and sends a LINE message
when CDC ActionZone prints a **BUY** or **SELL** on one of the last two daily
bars. The message also says where price sits against the regression trend, in
standard deviations. Each signal is sent once: `signal_notifications` records
what went out, keyed by symbol, bar date and side. If a send fails, the signal
is retried on the next check. Symbols Yahoo cannot price are skipped. The
offline demo series is never used here.

A signal on today's bar is computed from an unfinished bar, just as on the
chart, so it can still disappear before the close.

Setup, in `.env`:

| Variable | |
| --- | --- |
| `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` | Messaging API channel. Each send issues a 15-minute stateless token from these, so there is no long-lived token to rotate. Without them the scheduler stays off. |
| `LINE_TO` | Optional user or group ID to push to. Unset, the message is **broadcast** to everyone who has added the bot. |
| `SIGNAL_ALERT_INTERVAL_MINUTES` | Optional, default 30. `0` turns the scheduler off. |

Then run `npm run db:migrate` (for `0004_signal_notifications.sql`) and add the
bot as a LINE friend. To check by hand:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/alerts/signals?test=1"                  # test message
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/alerts/signals?dryRun=1&lookback=30"    # preview, sends nothing
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/alerts/signals"                         # check and send now
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/alerts/signals?digest=1"                # every symbol's last BUY/SELL, as one message
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/alerts/signals?report=close"           # portfolio report now (dryRun=1 to preview)
```

**Portfolio report at the US close.** On weekdays at 16:05
New York time (so daylight saving is handled), every holding with a quantity is
priced and sent as one message. Each holding shows the day's change in percent
and dollars, its CDC status, and its last BUY/SELL with how long ago it was.
The message starts with the portfolio's day change, its value and its total
gain. In Bangkok that is 03:05 while the US is on summer time and 04:05 in
winter. A weekday with no US equity bar dated today is a
holiday and is skipped. `portfolio_reports` (migration 0005) claims each slot,
so a restart cannot send it twice. If the Pi was down at the bell, the report
still goes out for up to an hour afterwards. `PORTFOLIO_REPORT=0` turns it off.

**Gains are real.** Each period's gain is today's value, less the position at
the start of the period at that day's close, less what was bought, plus what
was sold, less fees. The starting position is rebuilt from the trade log, so a
position bought mid-week counts only from the price actually paid, and each
trade inside the period is listed under its holding.

**The week's last trading day reports the week** (Friday, or Thursday when
Friday is an NYSE holiday such as Good Friday). It is measured from the last
close before Monday. **The week holding the month's last Friday reports the
month** instead. That report runs from the previous month's report day, and
its header carries the week as well. Trading days after the last Friday belong
to the next month. Holidays come from `src/lib/us-market-calendar.ts`, which
implements NYSE's published rules. Test with `?report=close&period=week` or `&period=month`.

## Docker

```bash
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose up -d --build
```

Two services:

| Service | Image | Notes |
| --- | --- | --- |
| `db` | `postgres:17-alpine` | data in the `pgdata` volume, schema applied from `db/migrations/` on first init, published only on `127.0.0.1` |
| `fin-port` | built from `Dockerfile` | waits for the database's healthcheck, connects to `db:5432` |

The healthcheck is not decoration: Postgres starts, runs its init scripts, then
restarts, and an app that connected during that first pass would get a refused
connection and a dashboard full of empty tables.

Useful from here:

```bash
docker compose logs -f fin-port
docker compose exec db psql -U finport finport
docker compose down          # stop, keep the data
docker compose down -v       # stop and DELETE the pgdata volume
```

`.dockerignore` excludes `.env*` and `data/`, so no credential or statement is
baked into an image layer.
