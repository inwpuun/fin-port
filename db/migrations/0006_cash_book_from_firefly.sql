-- ===========================================================================
-- fin-port schema, part 6: the cash book lives in Firefly III
--
-- The app reads the ledger straight from Firefly's API and keeps it in memory
-- (src/lib/cash-book/firefly-book.ts), so the local copy and the rollups that
-- only read it go. THB cash stays in holding_transactions, rebuilt from the
-- Firefly book.
--
-- Idempotent: drops only what exists. Note that 0001 recreates these tables
-- when every migration is re-applied in order; this file runs after it and
-- drops them again.
-- ===========================================================================

drop function if exists public.cash_monthly_summary;
drop function if exists public.cash_category_totals;
drop function if exists public.cash_years;

drop table if exists public.cash_transactions;
drop table if exists public.cash_accounts;
