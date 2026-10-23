-- Phase 6: billing. Paystack (auto-renewing monthly card subscriptions) and
-- OPay (30-day prepaid passes; OPay's Cashier has no recurring billing).
--
-- `subscriptions` stays the one row per creator that says which plan they are
-- on. `payments` is the ledger of every checkout and renewal. Both are
-- server-owned: creators can read their own rows and never write them. All
-- writes come from the billing service with the service-role key, after it
-- has verified the payment with the provider.

-- ---------------------------------------------------------------------------
-- subscriptions: plan list, provider and Paystack details
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add constraint subscriptions_plan_check check (plan in ('free', 'pro', 'studio')),
  -- Null until the creator first pays.
  add column provider text check (provider in ('paystack', 'opay')),
  add column provider_plan_code text,
  -- Paystack needs it to disable a subscription. Never sent to the browser.
  add column provider_email_token text;

create index subscriptions_provider_customer_id_idx
  on public.subscriptions (provider_customer_id)
  where provider_customer_id is not null;

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  provider text not null check (provider in ('paystack', 'opay')),
  kind text not null check (kind in ('subscription_start', 'renewal', 'pass')),
  plan text not null check (plan in ('pro', 'studio')),
  -- Ours (`ch_…`) for checkouts; Paystack's for renewals it charged itself.
  reference text not null check (char_length(reference) between 1 and 200),
  provider_order_id text,
  provider_customer_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 200),
  applied_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, reference)
);

create index payments_user_id_created_at_idx on public.payments (user_id, created_at desc);

create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;
alter table public.payments force row level security;

revoke all on public.payments from anon, authenticated;
grant all on public.payments to service_role;
grant select on public.payments to authenticated;

create policy payments_select_own on public.payments
  for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------
-- apply_pass_payment: turn a verified OPay payment into 30 days of access
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER and executable only by service_role (which bypasses RLS):
-- the billing service calls it after OPay's Status API confirmed the payment
-- and the amount. Idempotent: `applied_at` is set once, so a replayed callback
-- or a second return-page visit changes nothing.
--
-- A pass on the plan the creator already holds through OPay stacks onto the
-- remaining time. Anything else (free, an expired plan, an upgrade) starts
-- 30 days from now on the new plan.
create function public.apply_pass_payment(p_reference text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
begin
  update public.payments
    set status = 'succeeded', applied_at = now(), failure_reason = null
    where provider = 'opay' and kind = 'pass' and reference = p_reference and applied_at is null
    returning * into v_payment;

  if not found then
    return jsonb_build_object('applied', false);
  end if;

  select * into v_sub from public.subscriptions where user_id = v_payment.user_id for update;

  if found
    and v_sub.provider = 'opay'
    and v_sub.plan = v_payment.plan
    and v_sub.status = 'active'
    and v_sub.current_period_end > now() then
    v_end := v_sub.current_period_end + interval '30 days';
  else
    v_end := now() + interval '30 days';
  end if;

  insert into public.subscriptions as s (
    user_id, plan, status, provider, provider_customer_id, provider_subscription_id,
    provider_plan_code, provider_email_token, current_period_end, cancel_at_period_end
  )
  values (v_payment.user_id, v_payment.plan, 'active', 'opay', null, null, null, null, v_end, true)
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = 'active',
    provider = 'opay',
    provider_customer_id = null,
    provider_subscription_id = null,
    provider_plan_code = null,
    provider_email_token = null,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = true;

  return jsonb_build_object('applied', true, 'plan', v_payment.plan, 'current_period_end', v_end);
end;
$$;

revoke execute on function public.apply_pass_payment(text) from public, anon, authenticated;
grant execute on function public.apply_pass_payment(text) to service_role;
