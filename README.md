# Fin Port

Next.js financial dashboard for US stocks, gold, bitcoin, indices, a personal
portfolio, and a Thai-baht cash ledger. Data lives in Supabase Postgres; the
CSV exports are only an import format.

## Pages

- `/` market watch with TradingView-style chart, saved watchlist, price alerts and drawdown-from-top alerts
- `/portfolio` holdings from Postgres with live market value, FX-corrected net worth, P/L, allocation weights and drawdown flags
- `/cash-book` transaction ledger with year/account/category filters, monthly income-vs-expense flow, category breakdown, and CSV upload
- `/unlock` passphrase gate

## Security model

The point of this setup is that **no Supabase credential ever reaches a
browser**.

- No environment variable is named `NEXT_PUBLIC_*`. Next.js inlines any
  `NEXT_PUBLIC_` value into the client bundle, which publishes it to every
  visitor. Every Supabase call here runs in a Server Component, Server Action,
  or Route Handler.
- `src/lib/env.ts` and the data layer import `server-only`, so importing them
  from a Client Component fails the build instead of leaking at runtime.
- Every table has RLS enabled with **zero policies**, which denies `anon` and
  `authenticated` everything. Privileges are also explicitly revoked. The
  server reads and writes with the secret key, which bypasses RLS. If the
  publishable key leaks it grants nothing.
- `proxy.ts` puts the whole site behind a passphrase, so a Vercel deployment
  URL is not a public window onto your finances.
- Write endpoints and Server Actions re-check authorization themselves rather
  than trusting that the proxy ran.

Verify the bundle yourself after any change:

```sh
npm run build
grep -r "sb_publishable\|sb_secret\|ADMIN_TOKEN" .next/static   # must find nothing
```

## Setup

### 1. Create the schema

Supabase dashboard → SQL Editor → paste `supabase/migrations/0001_init.sql` →
Run. It is idempotent, so re-running is safe.

With the Supabase CLI instead:

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

### 2. Configure environment

```sh
cp .env.example .env.local
```

| Variable | Where to find it | Used for |
| --- | --- | --- |
| `SUPABASE_URL` | Project Settings → Data API | everything |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys | low-privilege reads |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → **Secret keys** | all reads and writes; bypasses RLS |
| `ADMIN_TOKEN` | `openssl rand -hex 32` | unlock passphrase and the import bearer token |

`SUPABASE_SECRET_KEY` is required. The publishable key cannot read or write
these tables by design.

### 3. Import the CSVs

The source files live in `data/` — deliberately **not** `public/`, because
anything in `public/` is served to the world at `https://<your-app>/my-port.csv`.

```sh
npm run db:seed        # data/my-port.csv, my-allocation.csv, my-watchlist.csv
npm run db:cash-book   # every data/cash-book/report-*.csv
npm run db:import      # both
npm run db:verify      # parse only, no database: sanity-check a new export
```

### 4. Run

```sh
npm install
npm run dev
```

Open `http://localhost:3000` and unlock with your `ADMIN_TOKEN`.

## Cash-book import

The exports have no id column, so each row's primary key is a content hash:

```
sha256(account | description | date | time | amount | category | memo | transfer) + ":" + occurrence
```

Account, description, date, time and amount are the natural key. Category,
memo and transfer are folded in because the real exports contain same-minute,
same-amount pairs on one account that differ only in those fields — hashing the
five alone would collapse two real transactions into one and lose money from
the ledger. `occurrence` is a final tie-break for byte-identical rows.

Because ids are derived from content, **import is an upsert**: re-importing the
same export is a no-op, a corrected export updates rows in place, and nothing
is ever deleted. Importing all three years twice yields exactly 3,038 rows.

Other handling worth knowing:

- Thai Buddhist Era dates (`31/12/2567`) convert to ISO Gregorian (`2024-12-31`). Years under 2400 are left alone, so a future locale change won't corrupt data.
- The exporter's `Category ► Subcategory` splits into two columns.
- Account header rows put the currency in the column labelled `Account`; the parser accounts for that.
- Amounts (`-1,083.51`, `+4,586.04`) parse to numerics.
- **Transfers are excluded from income and expense.** A move from K-bank to Dime Invest writes a debit and a credit; counting both reports the same baht twice. In this data 572 transfer rows sum to exactly 0.00, and including them inflates 2026 income from ฿341k to ฿812k. They still appear in the ledger table. Pass `p_include_transfers => true` to the rollup functions to see them.

### Three ways to import

Browser — `/cash-book` → **Import** → choose files. Uses your unlock session;
no token is exposed to JavaScript.

CLI — reads `data/` and talks to Supabase directly:

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

## Deploying to Vercel

1. Push to GitHub. `.gitignore` excludes `.env*` and all of `data/`, so no key and no financial data is committed.
2. Import the repo in Vercel.
3. Add all four environment variables under **Settings → Environment Variables**, for Production, Preview and Development. Vercel encrypts them and exposes them only to the server runtime. Do **not** tick any "expose to browser" option, and do not rename them with a `NEXT_PUBLIC_` prefix.
4. Deploy.
5. Recommended: **Settings → Deployment Protection → Vercel Authentication**. That puts your Vercel login in front of the app as a second layer, on top of the passphrase gate.

Import data into production once deployed, either by pointing `.env.local` at
the same project and running `npm run db:import`, or by uploading through
`/cash-book`.

### Rotating a key

Supabase → API Keys → create a new secret key → update it in Vercel → redeploy
→ revoke the old one. To change the passphrase, update `ADMIN_TOKEN`; existing
sessions stop validating immediately, since the cookie is signed with it.

## API

All routes require `Authorization: Bearer $ADMIN_TOKEN` or a valid unlock session.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/market?symbol=&range=&drawdownRange=` | quotes and candles (no auth; no private data) |
| `GET` | `/api/portfolio?drawdownRange=` | positions, totals, allocation buckets |
| `POST` | `/api/portfolio` | upsert a holding |
| `DELETE` | `/api/portfolio?id=` | remove a holding |
| `GET` `POST` `DELETE` | `/api/watchlist` | manage saved symbols |
| `POST` | `/api/cash-book/import` | CSV upsert |

## Schema

| Table | Source | Natural key |
| --- | --- | --- |
| `holdings` | `data/my-port.csv` | `symbol` |
| `allocations` | `data/my-allocation.csv` | `(category, symbol)` |
| `watchlist` | `data/my-watchlist.csv` | `symbol` |
| `cash_accounts` | account header rows | `name` |
| `cash_transactions` | transaction rows | content-hash `id` |

`holdings.cost_basis` is the **total** paid for the position, not a unit price;
average cost is derived. Cost currency is stored per position, so a THB cost
basis on a USD-quoted asset converts through live FX before it reaches any
total. When a rate is unavailable the UI says so instead of silently assuming
1:1, and a symbol whose quote fails is listed as unavailable and excluded from
totals rather than filled with demo prices.

## Symbols

`AAPL`, `NVDA`; `GC=F` or `GOLD` for gold; `BTC-USD` or `BTC` for bitcoin;
`^GSPC`, `^IXIC`, `^DJI`, `^NDX` for indices. `BRK.B` maps to `BRK-B`
automatically.

## Alerts

Load a symbol, set a price threshold or a drawdown percentage from the previous
top, choose the window (1 week to 1 year), then `Arm alerts`. Browser
notifications need the toggle plus browser permission, and fire while the app
is open.

## Docker

```sh
docker build -t fin-port .
docker run --rm -p 3000:3000 --env-file .env.local fin-port
```
