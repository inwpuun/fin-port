-- --------------------------------------------------------------------------
-- portfolio_reports
--
-- One row per US market open/close report. The scheduler claims a row before
-- it sends, so a restart inside the send window, or two processes, cannot
-- report the same bell twice. 'holiday' marks a weekday with no trading.
-- --------------------------------------------------------------------------
create table if not exists public.portfolio_reports (
  report_date date not null,
  kind        text not null check (kind in ('open', 'close')),
  status      text not null default 'pending' check (status in ('pending', 'sent', 'holiday')),
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  primary key (report_date, kind)
);
