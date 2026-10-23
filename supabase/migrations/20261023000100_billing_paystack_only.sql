-- Phase 6, part 3: Paystack is the only payment provider. OPay passes are
-- removed. OPay never ran against a real account, so its rows are dev or
-- test data: payments are deleted and subscriptions go back to Free.

delete from public.payments where provider = 'opay';

update public.subscriptions
  set plan = 'free', status = 'active', provider = null,
      current_period_end = null, cancel_at_period_end = false
  where provider = 'opay';

drop function public.apply_pass_payment(text);

-- `= any (array[...])` rather than `in (...)`: Postgres folds a one-value
-- `in` into `=`, and the schema-parity test reads value lists from `any`.
alter table public.subscriptions
  drop constraint subscriptions_provider_check,
  add constraint subscriptions_provider_check check (provider = any (array['paystack']));

alter table public.payments
  drop constraint payments_provider_check,
  add constraint payments_provider_check check (provider = any (array['paystack'])),
  drop constraint payments_kind_check,
  add constraint payments_kind_check check (kind in ('subscription_start', 'renewal'));
