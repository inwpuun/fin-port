-- ===========================================================================
-- fin-port schema
--
-- Security model: this is a private, single-user app. No browser ever holds a
-- Supabase key; every query runs from the Next.js server. RLS is therefore
-- enabled with NO policies at all, which denies `anon` and `authenticated`
-- everything. The server reaches the data with the secret key, which bypasses
-- RLS. If the publishable key ever leaks it grants exactly nothing.
-- ===========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- updated_at helper
-- --------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- holdings  <- data/my-port.csv
-- cost_basis is the TOTAL amount paid for the position, not a unit price.
-- --------------------------------------------------------------------------
create table if not exists public.holdings (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  quantity      numeric(24, 10) not null check (quantity >= 0),
  cost_basis    numeric(20, 4) not null check (cost_basis >= 0),
  cost_currency text not null default 'USD',
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint holdings_symbol_key unique (symbol)
);

drop trigger if exists holdings_touch_updated_at on public.holdings;
create trigger holdings_touch_updated_at
  before update on public.holdings
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- allocations  <- data/my-allocation.csv
-- A symbol maps to a category bucket. The `CASH` pseudo-symbol carries a
-- literal cash_value instead of a market-priced position.
-- --------------------------------------------------------------------------
create table if not exists public.allocations (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,
  symbol        text not null,
  cash_value    numeric(20, 4),
  cash_currency text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint allocations_category_symbol_key unique (category, symbol)
);

drop trigger if exists allocations_touch_updated_at on public.allocations;
create trigger allocations_touch_updated_at
  before update on public.allocations
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- watchlist  <- data/my-watchlist.csv
-- --------------------------------------------------------------------------
create table if not exists public.watchlist (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watchlist_symbol_key unique (symbol)
);

drop trigger if exists watchlist_touch_updated_at on public.watchlist;
create trigger watchlist_touch_updated_at
  before update on public.watchlist
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- cash_accounts  <- the account header rows of data/cash-book/report-*.csv
-- --------------------------------------------------------------------------
create table if not exists public.cash_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  currency        text not null default 'THB',
  current_balance numeric(20, 4),
  balance_year    integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint cash_accounts_name_key unique (name)
);

drop trigger if exists cash_accounts_touch_updated_at on public.cash_accounts;
create trigger cash_accounts_touch_updated_at
  before update on public.cash_accounts
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- cash_transactions  <- the transaction rows of data/cash-book/report-*.csv
--
-- The source CSV has no id column, so `id` is a deterministic content hash:
--   sha256(account | description | occurred_on | occurred_at | amount
--          | category | memo | transfer_account) + ':' + occurrence
--
-- The first five fields are the natural key. Category, memo and transfer are
-- folded in because the real exports contain two same-minute, same-amount
-- pairs on the same account that differ only in category/memo -- keying on
-- the five alone would silently drop one row of each pair. `occurrence` is a
-- final tie-break for rows that are byte-identical.
--
-- Re-importing the same CSV recomputes the same ids, so import is an upsert:
-- edited rows update in place, unchanged rows are no-ops, nothing duplicates.
-- --------------------------------------------------------------------------
create table if not exists public.cash_transactions (
  id               text primary key,
  fingerprint      text not null,
  occurrence       smallint not null default 0,
  account          text not null,
  transfer_account text,
  description      text not null default '',
  category         text,
  subcategory      text,
  occurred_on      date not null,
  occurred_at      time,
  memo             text,
  amount           numeric(20, 4) not null,
  currency         text not null default 'THB',
  check_no         text,
  tags             text,
  running_balance  numeric(20, 4),
  source_file      text,
  source_year      integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists cash_transactions_touch_updated_at on public.cash_transactions;
create trigger cash_transactions_touch_updated_at
  before update on public.cash_transactions
  for each row execute function public.touch_updated_at();

create index if not exists cash_transactions_occurred_on_idx
  on public.cash_transactions (occurred_on desc);
create index if not exists cash_transactions_account_idx
  on public.cash_transactions (account);
create index if not exists cash_transactions_category_idx
  on public.cash_transactions (category);
create index if not exists cash_transactions_source_year_idx
  on public.cash_transactions (source_year);
create index if not exists cash_transactions_fingerprint_idx
  on public.cash_transactions (fingerprint);

-- --------------------------------------------------------------------------
-- Monthly rollup for the cash-book page. Keeps the summary in Postgres
-- instead of shipping every row to the server to be reduced in JS.
--
-- Transfers are excluded by default. A move from K-bank to Dime Invest writes
-- two rows -- a debit and a credit -- so counting them would report the same
-- baht as both income and expense. In this data set 572 transfer rows sum to
-- exactly 0.00, and including them inflates 2026 income from 341k to 817k.
-- --------------------------------------------------------------------------
create or replace function public.cash_monthly_summary(
  p_year integer default null,
  p_include_transfers boolean default false
)
returns table (
  month    date,
  income   numeric,
  expense  numeric,
  net      numeric,
  tx_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_trunc('month', t.occurred_on)::date                as month,
    coalesce(sum(t.amount) filter (where t.amount > 0), 0)  as income,
    coalesce(sum(-t.amount) filter (where t.amount < 0), 0) as expense,
    coalesce(sum(t.amount), 0)                              as net,
    count(*)                                                as tx_count
  from public.cash_transactions t
  where (p_year is null or extract(year from t.occurred_on) = p_year)
    and (p_include_transfers or t.transfer_account is null)
  group by 1
  order by 1 desc;
$$;

-- --------------------------------------------------------------------------
-- Lock everything down. RLS on, zero policies => anon/authenticated get
-- nothing. Only the secret key (which bypasses RLS) can read or write.
-- --------------------------------------------------------------------------
alter table public.holdings          enable row level security;
alter table public.allocations       enable row level security;
alter table public.watchlist         enable row level security;
alter table public.cash_accounts     enable row level security;
alter table public.cash_transactions enable row level security;

revoke all on public.holdings, public.allocations, public.watchlist,
              public.cash_accounts, public.cash_transactions
  from anon, authenticated;

revoke execute on function public.cash_monthly_summary(integer, boolean) from anon, authenticated;

-- --------------------------------------------------------------------------
-- Category rollup. Doubles as the category filter list for the UI, so the
-- page never has to pull every row just to learn the distinct categories.
-- --------------------------------------------------------------------------
create or replace function public.cash_category_totals(
  p_year integer default null,
  p_include_transfers boolean default false
)
returns table (
  category text,
  income   numeric,
  expense  numeric,
  tx_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(t.category, 'Uncategorized')                   as category,
    coalesce(sum(t.amount) filter (where t.amount > 0), 0)  as income,
    coalesce(sum(-t.amount) filter (where t.amount < 0), 0) as expense,
    count(*)                                                as tx_count
  from public.cash_transactions t
  where (p_year is null or extract(year from t.occurred_on) = p_year)
    and (p_include_transfers or t.transfer_account is null)
  group by 1
  order by 3 desc;
$$;

-- --------------------------------------------------------------------------
-- Distinct years present in the ledger, for the year picker.
-- --------------------------------------------------------------------------
create or replace function public.cash_years()
returns table (year integer, tx_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select extract(year from t.occurred_on)::integer as year, count(*) as tx_count
  from public.cash_transactions t
  group by 1
  order by 1 desc;
$$;

revoke execute on function public.cash_category_totals(integer, boolean) from anon, authenticated;
revoke execute on function public.cash_years() from anon, authenticated;
