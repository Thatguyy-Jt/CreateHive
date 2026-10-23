# Billing: Paystack only (remove OPay)

## Goal

Paystack (monthly card subscription, NGN) becomes the only way to pay for Pro. OPay's 30-day passes are removed from the code, the UI, the copy, the database and the tests. Nothing about Paystack's behaviour changes.

Why: OPay was never confirmed against its sandbox (its docs conflict on the base URL, how status requests are signed and the amount units), and its merchant onboarding blocks manual testing. One provider keeps Phase 6 small and testable. This is an owner decision made on 2026-10-23.

## Skills Read

None apply. This is a removal inside existing billing code, with no new AI, UI patterns or animation.

## Existing Code Inspected

- `lib/billing/`: `opay.ts` (the adapter), `plans.ts` (`OpayConfig`, `OPAY_*` env, `OPAY_SANDBOX_BASE_URL`, `PASS_DAYS`), `index.ts` (builds `opay` deps), `entitlement.ts` (`provider_conflict`, the OPay `renew` mode), `plan-options.ts` (the two buttons), `format.ts` (`PROVIDER_LABELS`, the `pass` kind label), `errors.ts`.
- `lib/services/billing.ts`: `BillingDeps.opay`, `startCheckout` (the OPay cashier branch), `confirmPayment` → `confirmOpay` (the `apply_pass_payment` RPC), `handleOpayCallback`, `coversUntil` (30 days for OPay).
- `lib/schemas/enums.ts`: `billingProvider = ["paystack","opay"]`, `paymentKind` includes `pass`, and the schema-parity map.
- `app/api/webhooks/opay/route.ts`, `app/app/settings/billing/actions.ts` (the `provider` form field), `app/app/settings/billing/return/route.ts` (`provider` query param).
- `components/billing/`: `billing-content.tsx` (OPay branches, `available.opay`, OPay copy), `checkout-buttons.tsx`, `checkout-notice-toast.tsx` (`cancelled`, used only by OPay's cancelUrl), `billing-history.tsx` (receipts note).
- `app/pricing/page.tsx` (the "Two ways to pay" section and FAQ), `components/pricing/plan-cta.tsx` ("Card or OPay").
- `lib/observability/log.ts` (a comment), `lib/supabase/database.types.ts` (`apply_pass_payment`).
- Migrations `20261021000100_billing.sql` (provider and kind checks, `apply_pass_payment`) and `20261022000100_billing_free_pro.sql` (redefines `apply_pass_payment`).
- Tests: `tests/billing/providers.test.ts` (an OPay client block), `tests/billing/plans.test.ts`, `tests/services/billing.test.ts` (OPay checkout, callback and cancel cases), `tests/db/billing.test.ts` (`apply_pass_payment` suite and OPay rows), `tests/db/helpers.ts` and `tests/db/rls-isolation.test.ts` (seed OPay pass rows).
- `.env.example` (lists no billing variables), `PHASES.md` (Phase 6 section).

## Decisions / Assumptions

1. **A new forward migration rather than editing the two existing billing migrations.** Those two may already be applied to the Supabase project, and a new migration is correct either way.
2. **OPay data is deleted, not converted.** OPay never worked against a real sandbox, so any `provider='opay'` rows are dev or test data. OPay payments are deleted. A subscription row with `provider='opay'` is reset to a plain Free row (`plan='free'`, `status='active'`, `provider=null`, `current_period_end=null`, `cancel_at_period_end=false`). The row is kept because other code expects one row per creator.
3. **The `provider` column, the `billingProvider` enum and `?provider=` in the return URL stay, narrowed to `paystack`.** This keeps the schema and the payments ledger provider-aware, so another provider could be added later without a reshape. The enum becomes `z.enum(["paystack"])`.
4. **The checkout form no longer posts a `provider` field.** `startCheckoutAction` always starts a Paystack checkout. `CheckoutRequest.provider` is removed from the service.
5. **`provider_conflict` and the `renew` checkout mode are removed.** With one provider, the only checkout block left is `already_on_plan`. `CheckoutDecision` becomes `{ allowed: true } | { allowed: false; code: "already_on_plan" }`. The `provider_conflict` error message is deleted.
6. **`provider_order_id` stays.** Paystack uses it for its transaction id.
7. **The `?checkout=cancelled` toast is removed.** Only OPay's cancelUrl produced it. Paystack's callback always carries a reference, which resolves to success, pending or failed.
8. **One pay button.** The Pro card on Free shows a single **Upgrade with card** button with the hint "Paystack · renews monthly". When Paystack isn't configured, the button is disabled with "Not available yet", as today. On Pro, the card shows only "Current plan".
9. **`.env.example` gains the billing variables**, with empty values: `APP_URL`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_PRO`, `BILLING_PRICE_PRO_NGN`.
10. **Pro costs ₦12,000 a month.** `DEFAULT_PRO_PRICE_NGN` changes from 9,000 to 12,000 (1,200,000 kobo), so the price shows the same on Pricing, Billing, receipts and the dashboard. `BILLING_PRICE_PRO_NGN` can still override it. The Paystack test plan must be created at ₦12,000, or checkout refuses with `price_mismatch`. That check is unchanged.
11. Out of scope: any Paystack behaviour change, new UI, and Stripe.

## Files Likely to Change

| File | Change |
|---|---|
| `lib/billing/opay.ts` | **Delete** |
| `app/api/webhooks/opay/route.ts` | **Delete** (folder too) |
| `supabase/migrations/20261023000100_billing_paystack_only.sql` | **New**, see Database Changes |
| `lib/billing/plans.ts` | Remove `OpayConfig`, `BillingConfig.opay`, `OPAY_*` reading, `OPAY_SANDBOX_BASE_URL`, `PASS_DAYS`; fix the `priceNaira` comment; `DEFAULT_PRO_PRICE_NGN = 12_000` and the `formatNaira` example comment "₦12,000" |
| `lib/billing/index.ts` | Drop the `opay` dep |
| `lib/billing/entitlement.ts` | Remove `provider_conflict` and the OPay `renew` path; update comments |
| `lib/billing/plan-options.ts` | Paystack option only; `checkoutOptions(entitlement, plan, available: boolean)` |
| `lib/billing/format.ts` | `PROVIDER_LABELS = { paystack: "Paystack" }`; drop the `pass` label |
| `lib/billing/errors.ts` | Remove `provider_conflict` |
| `lib/schemas/enums.ts` | `billingProvider = ["paystack"]`, `paymentKind = ["subscription_start","renewal"]` |
| `lib/services/billing.ts` | Remove `opay` dep, `confirmOpay`, `handleOpayCallback`, the OPay checkout branch, the OPay `coversUntil` branch and `PASS_DAYS`; `confirmPayment` calls `confirmPaystack` directly |
| `lib/supabase/database.types.ts` | Remove `apply_pass_payment` from `Functions` (hand-edited to match, as `pnpm db:types` needs a linked project) |
| `lib/observability/log.ts` | The comment says `paystack` only |
| `app/app/settings/billing/actions.ts` | No `provider` field; Paystack only; update the doc comment |
| `app/app/settings/billing/return/route.ts` | Update the doc comment (Paystack only) |
| `components/billing/billing-content.tsx` | `available: boolean`; remove OPay branches and copy (see UI) |
| `components/billing/checkout-buttons.tsx` | Unchanged structure; still renders the options it's given |
| `components/billing/checkout-notice-toast.tsx` | Remove `cancelled` |
| `components/billing/billing-history.tsx` | Note: "Paystack also emails its own receipt." |
| `app/pricing/page.tsx` | Payment section and FAQ, see UI |
| `components/pricing/plan-cta.tsx` | "Card through Paystack · cancel any time" |
| Tests (listed under Checks) | Remove OPay cases; adjust fixtures to Paystack |
| `.env.example` | Add the billing variables (decision 9) |
| `PHASES.md` | Phase 6: Paystack only, with a dated note that OPay was removed |
| `prompts/billing-paystack-opay.md`, `prompts/pricing-and-billing-settings.md` | Left as history; not edited |

## Database Changes

New migration `supabase/migrations/20261023000100_billing_paystack_only.sql`:

```sql
-- Phase 6, part 3: Paystack is the only payment provider. OPay passes are
-- removed. OPay never ran against a real account, so its rows are dev or test data.

delete from public.payments where provider = 'opay';

update public.subscriptions
  set plan = 'free', status = 'active', provider = null,
      current_period_end = null, cancel_at_period_end = false
  where provider = 'opay';

drop function public.apply_pass_payment(text);

alter table public.subscriptions
  drop constraint subscriptions_provider_check,
  add constraint subscriptions_provider_check check (provider in ('paystack'));

alter table public.payments
  drop constraint payments_provider_check,
  add constraint payments_provider_check check (provider = 'paystack'),
  drop constraint payments_kind_check,
  add constraint payments_kind_check check (kind in ('subscription_start', 'renewal'));
```

The constraint names are Postgres's defaults for the inline checks in `20261021000100_billing.sql`. Implementation confirms them against PGlite before relying on them. No RLS or grant changes are needed: the policies are unchanged, and the dropped function's grants go with it.

## Implementation Requirements

### Checkout
- `startCheckoutAction(prev, formData)` parses `{ plan }` only, gets the email from Clerk, and calls `startCheckout(deps, { userId, email, plan })`.
- `startCheckout` returns `not_configured` when `appUrl` or Paystack is missing. Otherwise the existing Paystack path runs unchanged: entitlement check (`already_on_plan`), throttle, `missing_email`, price match, insert `subscription_start`, initialize, redirect.

### Confirming
- `confirmPayment` keeps its idempotent early return, then calls `confirmPaystack`. `confirmReturn` and `checkPayment` are unchanged apart from types.

### Webhooks
- `/api/webhooks/opay` no longer exists, so requests to it get a 404. `/api/webhooks/paystack` is unchanged.

### UI (`components/billing/billing-content.tsx`)
- `PlanRow` takes `available: boolean`. On Free, it shows `CheckoutButtons` with the single Paystack option. On Pro, it shows "Current plan" only.
- Remove the OPay branches from `statusLine` ("Pass ends …") and from the payment-method line ("OPay · pay per 30-day pass").
- Subscription card footer: paid → `SubscriptionControls` (as today). Free → "Pay by card through Paystack. Renews monthly. Cancel any time."
- `BillingContent`: `available = Boolean(config.paystack && config.appUrl)`. In the load-error fallback it's `false`.

### Pricing page
- Replace the `PAYMENT_METHODS` list and the "Two ways to pay for Pro" section with one card. The heading is "How you pay for Pro"; the card is titled "Card through Paystack", with the existing Paystack body text. Keep the existing section layout, but render the single card in a `max-w-xl` container instead of the 2-column grid, so it doesn't sit half-width.
- FAQ "Can I cancel?": "Yes. Your subscription stops renewing and you keep Pro until the end of the month you paid for."

### Copy check
After the change, `grep -ri opay` over `app components lib tests supabase/migrations/20261023*` finds nothing except the new migration's comment and its `provider = 'opay'` cleanup statements. The two older migrations keep their history.

## AI Behavior

None. AI allowances and entitlement-based caps are unchanged, since a Paystack Pro still resolves to `pro`.

## Security Requirements

- Unchanged: the Paystack secret is server-only, webhook HMAC is checked in constant time, `userId` comes from `auth.protect()`, and billing writes use the service role only.
- One fewer public unauthenticated endpoint, because the OPay callback route is removed.
- The `OPAY_*` env variables are no longer read. Remove them from any deployment env.

## Acceptance Criteria

1. No OPay code, env reading, route, UI copy or test remains (apart from the copy-check exceptions above).
2. The new migration applies cleanly in PGlite. The schema-parity test passes with `billingProvider = ["paystack"]` and `paymentKind = ["subscription_start","renewal"]`. Inserting a `provider='opay'` or `kind='pass'` payment is rejected, and `apply_pass_payment` no longer exists.
3. Existing OPay rows are converted as described in decision 2 (tested in `tests/db/billing.test.ts`).
4. On Free, Billing shows one **Upgrade with card** button. It's enabled when `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_PRO` and `APP_URL` are set, and disabled with "Not available yet" otherwise.
5. All existing Paystack tests (checkout guards, confirm, webhooks, renewals, cancel, manage link) still pass unchanged in intent.
6. With `BILLING_PRICE_PRO_NGN` unset, Pro shows **₦12,000 /month** on Pricing and Billing, and checkout charges 1,200,000 kobo.
7. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Tests to update:
- `tests/billing/providers.test.ts`: delete the `OPay client` block and its imports.
- `tests/billing/plans.test.ts`: change the default-price expectations to 12,000 (`₦12,000`, 1,200,000 kobo); remove the OPay env, entitlement, `checkoutDecision` and `checkoutOptions` cases. Add a case checking that `checkoutOptions` returns one Paystack option, blocked with "Not available yet" when unavailable.
- `tests/services/billing.test.ts`: remove the OPay checkout, callback, cancel and `coversUntil` cases, and the `opay` fake deps. Keep the Paystack cases, with their amounts changed to 1,200,000 kobo.
- `tests/db/billing.test.ts`: replace the `apply_pass_payment` suite with tests for the new constraints (`opay` provider and `pass` kind rejected), that the function no longer exists, and the decision 2 cleanup. Switch the remaining fixtures to Paystack rows.
- `tests/db/helpers.ts` and `tests/db/rls-isolation.test.ts`: seed Paystack `subscription_start` payments instead of OPay passes.

## Manual Test Procedure

**Setup:**
1. Apply all three billing migrations to Supabase.
2. In `.env.local`, set `APP_URL` (the ngrok https URL), `PAYSTACK_SECRET_KEY` (`sk_test_…`), `PAYSTACK_PLAN_PRO` (a monthly NGN test plan priced at **₦12,000**). Leave `BILLING_PRICE_PRO_NGN` unset, or set it to `12000`.
3. In the Paystack test dashboard, set the webhook URL to `APP_URL/api/webhooks/paystack`.
4. Restart `pnpm dev` and open the app through the ngrok URL.

**Steps:**
1. Free account → Settings › Billing: the Pro card shows **₦12,000 /month** and one **Upgrade with card** button (no OPay). The subscription card footer mentions Paystack only.
2. Click it. On the Paystack checkout, use test card `4084 0840 8408 4081`, any future expiry, CVV `408`, PIN `0000` and OTP `123456`. You return to Billing with a success toast; Pro shows "Current plan", the card shows its brand and last 4, and "Renews on …". The history row shows **Paid**.
3. Receipt, Download and Export CSV work for that row.
4. Cancel the subscription: "Cancelled. Pro stays active until …".
5. Replay the webhook from the Paystack dashboard: nothing changes.
6. `curl -X POST APP_URL/api/webhooks/paystack -H "x-paystack-signature: bad" -d "{}"` returns 401. `curl -X POST APP_URL/api/webhooks/opay -d "{}"` returns 404.
7. Unset `PAYSTACK_PLAN_PRO` and restart: the button shows "Not available yet".
8. `/pricing`: Pro shows ₦12,000 /month, one payment method card (Paystack), the FAQ has no OPay mention, and the Pro CTA reads "Card through Paystack · cancel any time".
9. At 375px width: the Billing and Pricing pages have no horizontal scroll, and the single payment card is full width.

### Visual expectations
- No new components or motion. The Pro card keeps its current layout with one button instead of two, and the button stays full width.
- Pricing "How you pay for Pro": one card, left-aligned under the heading, max width `xl`.
- Loading and error states are unchanged.

## Known Limitations

- There's no non-card payment option, so creators without a card that Paystack accepts can't upgrade.
- The older billing prompts still describe OPay. They're kept as history of what was built at the time.
