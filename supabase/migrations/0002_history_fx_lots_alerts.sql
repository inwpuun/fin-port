-- ===========================================================================
-- fin-port schema, part 2: history, exchange rates, trade log, alerts
--
-- Same security model as 0001: RLS enabled with NO policies, privileges
-- revoked, and only the secret key (which bypasses RLS) can read or write.
-- Idempotent, so re-running is safe.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- fx_rates
--
-- Every rate the app has ever seen, one row per (base, quote, as_of). This
-- exists so a conversion NEVER has to be invented: if the Bank of Thailand or
-- the FX provider is unreachable, the newest stored rate is used and labelled
-- stale. Before this table a failed lookup fell through to the offline demo
-- generator, which returned ~79 THB/USD and understated a real THB cost basis
-- by 59% with no warning anywhere on the page.
--
-- `rate` is quote units per ONE unit of base: (USD, THB, 32.4) means
-- 1 USD = 32.4 THB.
-- --------------------------------------------------------------------------
create table if not exists public.fx_rates (
  id         uuid primary key default gen_random_uuid(),
  base       text not null,
  quote      text not null,
  rate       numeric(24, 10) not null check (rate > 0),
  as_of      date not null,
  source     text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fx_rates_base_quote_as_of_key unique (base, quote, as_of)
);

drop trigger if exists fx_rates_touch_updated_at on public.fx_rates;
create trigger fx_rates_touch_updated_at
  before update on public.fx_rates
  for each row execute function public.touch_updated_at();

create index if not exists fx_rates_pair_as_of_idx
  on public.fx_rates (base, quote, as_of desc);

-- --------------------------------------------------------------------------
-- portfolio_snapshots
--
-- One row per calendar day (Asia/Bangkok), written by POST /api/snapshot --
-- run from Vercel Cron, see vercel.json. Nothing else in this app records
-- what the portfolio was worth yesterday, so without this table an equity
-- curve, a portfolio-level drawdown or a "since January" number cannot be
-- drawn at all: only per-symbol price history was ever available.
--
-- `complete` is false when a position could not be priced or converted. The
-- row is still written -- a gap is more useful than nothing -- but the chart
-- marks it and the missing symbols are named in `missing`.
-- --------------------------------------------------------------------------
create table if not exists public.portfolio_snapshots (
  id            uuid primary key default gen_random_uuid(),
  as_of         date not null,
  base_currency text not null default 'USD',
  market_value  numeric(20, 4) not null default 0,
  cost_basis    numeric(20, 4) not null default 0,
  profit_loss   numeric(20, 4) not null default 0,
  cash_value    numeric(20, 4) not null default 0,
  positions     integer not null default 0,
  complete      boolean not null default true,
  missing       jsonb not null default '[]'::jsonb,
  holdings      jsonb not null default '[]'::jsonb,
  rates         jsonb not null default '{}'::jsonb,
  source        text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint portfolio_snapshots_as_of_key unique (as_of)
);

drop trigger if exists portfolio_snapshots_touch_updated_at on public.portfolio_snapshots;
create trigger portfolio_snapshots_touch_updated_at
  before update on public.portfolio_snapshots
  for each row execute function public.touch_updated_at();

create index if not exists portfolio_snapshots_as_of_idx
  on public.portfolio_snapshots (as_of desc);

-- --------------------------------------------------------------------------
-- holding_transactions
--
-- The trade log. `holdings` carries one row per symbol -- a quantity and a
-- total cost basis -- which cannot express two buys at different prices, a
-- partial sell, or any realised gain: selling half a position and re-entering
-- lower simply overwrote the row and the realised profit vanished.
--
-- Ids are content hashes, the same discipline as cash_transactions, so
-- importing or re-posting the same trade twice is a no-op rather than a
-- duplicate. `side` covers buys, sells, cash dividends and standalone fees.
-- --------------------------------------------------------------------------
create table if not exists public.holding_transactions (
  id          text primary key,
  symbol      text not null,
  side        text not null check (side in ('buy', 'sell', 'dividend', 'fee')),
  quantity    numeric(24, 10) not null default 0 check (quantity >= 0),
  price       numeric(24, 10) not null default 0 check (price >= 0),
  fee         numeric(20, 4)  not null default 0 check (fee >= 0),
  currency    text not null default 'USD',
  occurred_on date not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists holding_transactions_touch_updated_at on public.holding_transactions;
create trigger holding_transactions_touch_updated_at
  before update on public.holding_transactions
  for each row execute function public.touch_updated_at();

create index if not exists holding_transactions_symbol_date_idx
  on public.holding_transactions (symbol, occurred_on, id);

-- --------------------------------------------------------------------------
-- alert_rules / alert_events
--
-- The browser notifications this app used to raise only fired while a tab
-- happened to be open, which is not monitoring -- so they were removed. These
-- two tables are the server-side replacement: rules are evaluated by
-- POST /api/alerts/run on a schedule and delivered to Telegram, LINE or a
-- webhook, whether or not anyone has the site open.
--
-- `cooldown_hours` stops a rule that is continuously true from sending one
-- message per run; alert_events is both the delivery log and the cooldown
-- state, so the same breach is reported once a day rather than hourly.
-- --------------------------------------------------------------------------
create table if not exists public.alert_rules (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,
  kind           text not null check (
                   kind in ('drawdown', 'price_below', 'price_above',
                            'zscore_below', 'zscore_above')
                 ),
  threshold      numeric(20, 6) not null,
  enabled        boolean not null default true,
  cooldown_hours integer not null default 24 check (cooldown_hours >= 0),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint alert_rules_symbol_kind_key unique (symbol, kind)
);

drop trigger if exists alert_rules_touch_updated_at on public.alert_rules;
create trigger alert_rules_touch_updated_at
  before update on public.alert_rules
  for each row execute function public.touch_updated_at();

create table if not exists public.alert_events (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid references public.alert_rules (id) on delete cascade,
  symbol         text not null,
  kind           text not null,
  threshold      numeric(20, 6) not null,
  observed       numeric(20, 6) not null,
  message        text not null default '',
  delivered      boolean not null default false,
  delivery_error text,
  channels       jsonb not null default '[]'::jsonb,
  fired_at       timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists alert_events_touch_updated_at on public.alert_events;
create trigger alert_events_touch_updated_at
  before update on public.alert_events
  for each row execute function public.touch_updated_at();

create index if not exists alert_events_rule_fired_idx
  on public.alert_events (rule_id, fired_at desc);
create index if not exists alert_events_fired_idx
  on public.alert_events (fired_at desc);

-- --------------------------------------------------------------------------
-- Lock everything down, exactly as 0001 does.
-- --------------------------------------------------------------------------
alter table public.fx_rates             enable row level security;
alter table public.portfolio_snapshots  enable row level security;
alter table public.holding_transactions enable row level security;
alter table public.alert_rules          enable row level security;
alter table public.alert_events         enable row level security;

revoke all on public.fx_rates, public.portfolio_snapshots,
              public.holding_transactions, public.alert_rules,
              public.alert_events
  from anon, authenticated;

-- --------------------------------------------------------------------------
-- Latest rate per pair, so a conversion is one round trip instead of one
-- query per currency.
-- --------------------------------------------------------------------------
create or replace function public.fx_latest_rates(p_base text default 'USD')
returns table (
  base   text,
  quote  text,
  rate   numeric,
  as_of  date,
  source text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (r.quote) r.base, r.quote, r.rate, r.as_of, r.source
  from public.fx_rates r
  where r.base = p_base
  order by r.quote, r.as_of desc;
$$;

revoke execute on function public.fx_latest_rates(text) from anon, authenticated;
