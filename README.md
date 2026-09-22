# Fin Port

Next.js financial dashboard for US stocks, gold, bitcoin, indices, a personal
portfolio, and a Thai-baht cash ledger. Data lives in a Postgres that runs
beside the app in `docker-compose.yml`; the CSV exports are only an import
format.

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
- `/portfolio` holdings tracker with calculated buy price, quantity, live market value, total net worth, P/L, and drawdown flags
- `/watchlist` watchlist tracker with live prices, one-year moves, drawdown flags, and a signal column
- `/allocation` allocation chart and category table
- `/cash-book` ledger with per-year overview, category and description breakdowns, graphs, transaction modals, and CSV import
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
| `/cash-book` | `cash_transactions` |

Because the importer upserts, re-importing an unchanged export still moves the
timestamp — the label answers "when was this data last written", not "when did
a value last differ". The absolute time renders first and is pinned to
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
| `ADMIN_TOKEN` | `openssl rand -hex 32` | unlock passphrase and the import bearer token |
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
data/cash-book/report-*.csv
```

```sh
npm run db:seed        # holdings, allocations, watchlist
npm run db:cash-book   # every data/cash-book/report-*.csv
npm run db:import      # both
npm run db:verify      # parse only, no database: sanity-check a new export
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
| `cash_accounts` | account header rows | `name` |
| `cash_transactions` | transaction rows | content-hash `id` |

`src/lib/my-port.ts`, `src/lib/my-watchlist.ts` and `src/lib/cash-book.ts` keep
the same exported functions they had when they read CSV files, so the pages and
components above them are unchanged — only the backing store moved.

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

## Editing a position

`/portfolio` and `/allocation` share one editor (`holding-editor-modal.tsx`).
Open it from **Add by quantity and buy price** on `/portfolio`, or the **Edit**
button on any row of either page.

It takes a quantity and a per-unit buy price and stores their product as the
cost basis, alongside the allocation category. Entering the position this way
needs no market quote, so it works for assets priced in THB — the holding
value + % profit form still requires a USD quote to derive a quantity, and says
so if the symbol returns another currency.

A symbol belongs to exactly one lane. Because `allocations` is keyed on
`(category, symbol)`, moving a symbol deletes its previous row first; otherwise
it would be counted in two lanes and inflate the total. Deleting a holding also
clears its lane, so no symbol is left behind with no value against it.

For the `CASH` pseudo-symbol the editor swaps quantity and price for a cash
balance and currency, and writes through `/api/allocation`.

## Cash-book import

The exports have no id column, so each row's primary key is a content hash:

```
sha256(account | description | date | time | amount | category | memo | transfer) + ":" + occurrence
```

Account, description, date, time and amount are the natural key. Category, memo
and transfer are folded in because the real exports contain same-minute,
same-amount pairs on one account that differ only in those fields — hashing the
five alone would collapse two real transactions into one and lose money from
the ledger. `occurrence` is a final tie-break for byte-identical rows.

Because ids are derived from content, **import is an upsert**: re-importing the
same export is a no-op, a corrected export updates rows in place, and nothing
is deleted. Importing all three years twice yields exactly 3,038 rows. Ids are
also stable across imports, unlike the old `file:rowIndex` form which shifted
whenever a row was inserted upstream.

Other handling worth knowing:

- Thai Buddhist Era dates (`31/12/2567`) convert to ISO Gregorian (`2024-12-31`). Years under 2400 are left alone, so a future locale change won't corrupt data.
- The exporter's `Category ► Subcategory` splits into two columns and is rejoined for display.
- Account header rows put the currency in the column labelled `Account`; the parser accounts for that.
- Amounts (`-1,083.51`, `+4,586.04`) parse to numerics.
- **Transfers are excluded from income and expense.** A move from K-bank to Dime Invest writes a debit and a credit; counting both reports the same baht twice. In this data 572 transfer rows sum to exactly 0.00, and including them inflates 2026 income from ฿341k to ฿812k. `getCashBookTransactions()` filters them out, and the SQL rollups take `p_include_transfers => true` if you ever want them.

### Three ways to import

Browser — `/cash-book` → **Import** → choose files. Uses your unlock session;
no token is exposed to JavaScript.

CLI — reads `data/` and connects with `DATABASE_URL`:

```sh
npm run db:cash-book
npx tsx scripts/import.ts cash-book path/to/another-export.csv
```

HTTP — for automation:

```sh
curl -X POST https://<your-app>/api/cash-book/import \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "files=@data/cash-book/report-2026.csv"
```

## API

Every route requires a session cookie or `Authorization: Bearer $ADMIN_TOKEN`.
Nothing but `/unlock` and static assets answers without one.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/market?symbol=&range=&drawdownRange=&overlays=` | quotes, candles and analytics |
| `GET` | `/api/exchange-rate/usd-thb` | BOT reference rate |
| `GET` `POST` `DELETE` | `/api/watchlist/my-watchlist` | saved symbols |
| `POST` `DELETE` | `/api/portfolio/my-port` | required | upsert or remove a holding, and its allocation lane |
| `GET` `POST` `DELETE` | `/api/allocation` | required | move a symbol between lanes, edit the cash balance |
| `POST` | `/api/cash-book/import` | required | CSV upsert |

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

Import into a deployment either by pointing `DATABASE_URL` at it and running
`npm run db:import`, or by uploading through `/cash-book`.

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
**Trend / Risk / Value** control. Each one changes what is plotted, adds its own
lower pane, and swaps the metrics panel beside it:

| Lens | Chart | Answers |
| --- | --- | --- |
| **Trend** | 50/200-day averages, golden and death crosses marked, lower pane of % from the 200-day average | Is this in an up regime? |
| **Risk** | Underwater drawdown curve, plus annualised 60-day volatility | How large a position, and is this a good moment? |
| **Value** | Least-squares fit of log price with +/-1 and +/-2 sigma bands, lower pane of sigma from trend | Is the price stretched against its own trend? |

Ranges run 1M, 3M, 6M, 1Y, 2Y, 5Y, and the axis defaults to logarithmic so
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
recomputed from the candles is sent: the averages and the volatility (they need
warm-up bars the window does not carry) and the drawdown (its peak may sit
before the window). The regression channel and the z-score line are drawn from
the three numbers in `analytics.value.logFit`, and a route only pays for
overlays if it asks with `overlays=1` -- the tables do not.

### Alerts were removed

`/` used to arm a price threshold and a drawdown threshold and raise browser
notifications. That is gone, along with the notification permission toggle: an
alert that only fires while a tab happens to be open is not a monitoring
system. The drawdown *measurement* stayed -- `previousTop`, `drawdownPercent`
and the top-window selector are still on `/`, `/portfolio` and `/watchlist`, and
the risk lens reports the same fall against the whole loaded history.

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
