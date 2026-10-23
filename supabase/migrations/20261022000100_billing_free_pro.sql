-- Phase 6, part 2: Free and Pro only (Studio removed), and display-only card
-- details for Paystack subscriptions.

-- Studio could only exist in dev or test data; keep those creators paid.
update public.subscriptions set plan = 'pro' where plan = 'studio';
update public.payments set plan = 'pro' where plan = 'studio';

alter table public.subscriptions
  drop constraint subscriptions_plan_check,
  add constraint subscriptions_plan_check check (plan in ('free', 'pro'));

alter table public.payments
  drop constraint payments_plan_check,
  add constraint payments_plan_check check (plan in ('pro'));

-- From the Paystack subscription's authorization. Brand, last 4 digits and
-- expiry are safe to store and show; full card data never reaches us.
alter table public.subscriptions
  add column card_brand text check (char_length(card_brand) between 1 and 30),
  add column card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  add column card_exp text check (card_exp ~ '^[0-9]{2}/[0-9]{2}$');

-- Same as before, but an OPay pass also clears Paystack card details.
create or replace function public.apply_pass_payment(p_reference text)
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
    provider_plan_code, provider_email_token, card_brand, card_last4, card_exp,
    current_period_end, cancel_at_period_end
  )
  values (v_payment.user_id, v_payment.plan, 'active', 'opay', null, null, null, null, null, null, null, v_end, true)
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = 'active',
    provider = 'opay',
    provider_customer_id = null,
    provider_subscription_id = null,
    provider_plan_code = null,
    provider_email_token = null,
    card_brand = null,
    card_last4 = null,
    card_exp = null,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = true;

  return jsonb_build_object('applied', true, 'plan', v_payment.plan, 'current_period_end', v_end);
end;
$$;

-- `create or replace` keeps the existing grants: service_role only.
