-- --------------------------------------------------------------------------
-- signal_notifications
--
-- One row per CDC ActionZone BUY/SELL that has been pushed to LINE. The check
-- runs every half hour and looks at the last two daily bars, so without this
-- the same signal would be sent dozens of times. The primary key is the
-- de-duplication: a symbol prints at most one signal of each kind per bar.
-- --------------------------------------------------------------------------
create table if not exists public.signal_notifications (
  symbol     text not null,
  bar_date   date not null,
  signal     text not null check (signal in ('buy', 'sell')),
  price      numeric(20, 6) not null,
  message    text not null default '',
  sent_at    timestamptz not null default now(),
  primary key (symbol, bar_date, signal)
);

create index if not exists signal_notifications_sent_idx
  on public.signal_notifications (sent_at desc);
