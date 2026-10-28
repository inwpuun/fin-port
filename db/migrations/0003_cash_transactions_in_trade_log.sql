-- ===========================================================================
-- fin-port schema, part 3: cash deposits and withdrawals in the trade log
--
-- Cash used to be a single literal on the CASH allocation row: one value in
-- one currency, overwritten in place. That cannot hold a dollar balance and a
-- baht balance at once, and overwriting it erases when the money arrived, so
-- the net-worth history had no way to tell new money from investment growth.
--
-- Cash now lives in holding_transactions under the CASH symbol, as `deposit`
-- and `withdraw` rows whose `quantity` is the amount and whose `currency` says
-- which balance it moves. Idempotent like the rest: the constraint is dropped
-- and recreated under the same name.
-- ===========================================================================

alter table public.holding_transactions
  drop constraint if exists holding_transactions_side_check;

alter table public.holding_transactions
  add constraint holding_transactions_side_check
  check (side in ('buy', 'sell', 'dividend', 'fee', 'deposit', 'withdraw'));
