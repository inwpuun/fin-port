# Fin Port

Next.js financial dashboard for US stocks, gold, bitcoin, indices, a personal
portfolio, and a Thai-baht cash ledger. Data lives in Supabase Postgres; the
CSV exports are only an import format.

## Run

```bash
npm install
cp .env.example .env.local   # then fill it in, see Setup
npm run dev
```

Open `http://localhost:3000` and unlock with your `ADMIN_TOKEN`.

## Pages

- `/` market watch with TradingView-style chart, watchlist, price alerts, and drawdown-from-top alerts
- `/portfolio` holdings tracker with calculated buy price, quantity, live market value, total net worth, P/L, and drawdown flags
- `/watchlist` watchlist tracker with live prices, one-year moves, and drawdown flags
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

No Supabase credential ever reaches a browser.

- No environment variable is named `NEXT_PUBLIC_*`. Next.js inlines any
  `NEXT_PUBLIC_` value into the client bundle, which publishes it to every
  visitor. Every Supabase call runs in a Server Component or Route Handler.
- `src/lib/env.ts`, `src/lib/supabase/server.ts` and the data libs import
  `server-only`, so importing them from a Client Component fails the build
  instead of leaking at runtime.
- Every table has RLS enabled with **zero policies**, which denies `anon` and
  `authenticated` everything; privileges are revoked as well. The server uses
  the secret key, which bypasses RLS. A leaked publishable key grants nothing.
- `proxy.ts` puts the whole site behind a passphrase, so a Vercel deployment
  URL is not a public window onto your finances.
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

| Variable | Where to find it | Used for |
| --- | --- | --- |
| `SUPABASE_URL` | Project Settings → Data API | everything |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys | low-privilege reads |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → **Secret keys** | all reads and writes; bypasses RLS |
| `ADMIN_TOKEN` | `openssl rand -hex 32` | unlock passphrase and the import bearer token |
| `BOT_API_KEY` | Bank of Thailand developer portal | USD/THB reference rate for THB display |

`SUPABASE_SECRET_KEY` is required. The publishable key cannot read or write
these tables by design.

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

Postgres is the single source of truth, and no page caches rows in the browser.
The portfolio dashboard used to keep holdings in `localStorage` under
`fin-port-holdings-v3` and read that cache *before* the server data, returning
early when it found one. That made sense when the CSV was a read-only seed and
edits lived only in the browser, but with a real database it shadowed the
truth: an empty array is truthy once serialized, so opening the app once before
the import stored `"[]"` and every later visit short-circuited on it and never
queried again. Because `localStorage` is per-origin, a poisoned Vercel
deployment showed an empty table while `localhost` looked correct, and
`/allocation` — which reads the very same holdings without caching — was fine.
Don't reintroduce a client-side cache for rows the database owns.

That move is also what makes Vercel possible. The CSV version wrote back to
`public/*.csv` with `writeFile`, which cannot work on a serverless platform
where the filesystem is read-only; every portfolio and watchlist edit would
have failed in production. Docker Compose worked around it locally by
bind-mounting `./public`. That bind mount is no longer needed.

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

## API

Every route requires a session cookie or `Authorization: Bearer $ADMIN_TOKEN`.
Nothing but `/unlock` and static assets answers without one.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/market?symbol=&range=&drawdownRange=` | quotes and candles |
| `GET` | `/api/exchange-rate/usd-thb` | BOT reference rate |
| `GET` `POST` `DELETE` | `/api/watchlist/my-watchlist` | saved symbols |
| `POST` `DELETE` | `/api/portfolio/my-port` | required | upsert or remove a holding, and its allocation lane |
| `GET` `POST` `DELETE` | `/api/allocation` | required | move a symbol between lanes, edit the cash balance |
| `POST` | `/api/cash-book/import` | required | CSV upsert |

## Diagnosing a deployment

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-app>/api/health
```

Reports whether Postgres is reachable, a row count per table, which variables
are *present* (never their values), and warnings for a key pasted with stray
whitespace or a publishable key sitting in `SUPABASE_SECRET_KEY`.

This exists because a bad credential used to be almost invisible. The data libs
swallow errors so pages still render, so a wrong `SUPABASE_SECRET_KEY` looked
like "the holdings table is broken" while the watchlist quietly showed six
hardcoded starter symbols and appeared healthy. Every table was failing. The
watchlist no longer substitutes that list on an error -- only on a genuinely
empty table -- and `/api/health` answers the question directly.

If `database` is `reachable` with the right row counts but `/portfolio` is
still empty while `/allocation` shows the same holdings correctly, it is not a
data problem — see the note below on the removed localStorage cache. Hard
refresh once; the current build clears the stale key itself.

If `database` is `unreachable`, check in order:

1. Is `SUPABASE_SECRET_KEY` set for **this** environment? Vercel scopes
   variables per Production / Preview / Development, and Preview deployments
   are a common blind spot.
2. **Did you redeploy after adding it?** Environment changes do not reach a
   running deployment until the next deploy.
3. Any trailing newline or space from pasting? The `warnings` field flags it.
4. Is it the secret key, not the publishable one? Only the secret key bypasses
   RLS; the publishable key is denied every table by design.

## Deploying to Vercel

1. Push to GitHub. `.gitignore` excludes `.env*` and all of `data/`, so no key and no financial data is committed.
2. Import the repo in Vercel.
3. Add the environment variables under **Settings → Environment Variables** for Production, Preview and Development. Vercel encrypts them and exposes them only to the server runtime. Do not rename them with a `NEXT_PUBLIC_` prefix.
4. Deploy.
5. Recommended: **Settings → Deployment Protection → Vercel Authentication**, as a second layer on top of the passphrase gate.

Import into production either by pointing `.env.local` at the same project and
running `npm run db:import`, or by uploading through `/cash-book`.

### Passphrase hardening

`ADMIN_TOKEN` is the whole gate, so:

- **Generate it, don't invent it.** `openssl rand -hex 32` gives 256 bits;
  brute force is not a threat at that size. The app refuses to serve at all
  (503 on every page and API) if the token is under 24 characters, rather than
  pretending to be protected.
- **Failed attempts are rate limited** — 10 per 10 minutes on `/unlock`, 20 on
  bearer-token API calls, keyed by client IP. State is per serverless
  instance, so this is defence in depth, not a hard global cap; put Vercel's
  WAF in front of `/unlock` if you want one. A valid session cookie is checked
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

### Rotating a key

Supabase → API Keys → create a new secret key → update it in Vercel → redeploy
→ revoke the old one. To change the passphrase, update `ADMIN_TOKEN`; existing
sessions stop validating immediately, since the cookie is signed with it.

## Symbols

`AAPL`, `MSFT`, `NVDA` for US stocks; `GC=F` or `GOLD` for gold futures;
`BTC-USD` or `BTC` for bitcoin; `^GSPC`, `^IXIC`, `^DJI`, `^NDX` for indices.
`BRK.B` maps to `BRK-B` automatically.

## Alerts

Load a symbol, enter a price threshold or a drawdown percentage from the
previous top, choose the top window, and click `Arm alerts`.

Drawdown windows: 1 week, 2 weeks, 1 month, 2 months, 3 months, 1 year.

Browser notifications require the notification toggle plus browser permission.
They work while the app is open.

## Docker

```bash
docker build -t fin-port .
docker run --rm -p 3000:3000 --env-file .env.local fin-port
```

Or with Compose, which reads `.env.local`:

```bash
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose up -d --build
```

`.dockerignore` excludes `.env*` and `data/`, so no credential or statement is
baked into an image layer.
