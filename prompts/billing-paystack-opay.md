# Billing: plans, Paystack subscriptions and OPay passes (Phase 6)

All of Phase 6 (Billing) in `PHASES.md`. The product blueprint specifies Stripe. **Decision by the owner (2026-10-21): use Paystack + OPay instead.** Most creators are expected to be in Nigeria, and Stripe doesn't onboard Nigerian businesses. Stripe isn't built here.

| Provider | What it sells | Renewal |
|---|---|---|
| **Paystack** | Monthly card subscription (NGN) | Automatic, charged by Paystack each month |
| **OPay** (Cashier / online checkout) | **30-day pass** (NGN), paid by card, bank transfer, USSD or OPay wallet | Manual: the creator pays again. Passes stack on top of the remaining time |

OPay's online Cashier has **no recurring billing**. It takes one-off payments only, so an OPay purchase can't be an auto-renewing subscription.

Loop step served: none directly. This is the business layer that pays for the AI behind the loop and limits its cost (AGENTS.md §19, §20).

## Goal

1. Three plans, **Free, Pro and Studio**, each with its own daily AI generation cap, enforced by the existing AI service.
2. Paid plans can be bought through **Paystack** (auto-renewing monthly) or **OPay** (30-day pass).
3. Subscription state lives in `subscriptions`, written **only by the server** from provider data the server has verified. The browser is never trusted.
4. Webhooks for both providers, idempotent and safe to replay.
5. A `/app/billing` page with the current plan, usage, plan choices, cancel/manage, payment history and the return-from-checkout result.

## Skills Read

- `supabase`, `supabase-postgres-best-practices`: new table, column additions, RLS (server-owned and read-only to the creator), a `security definer` RPC restricted to `service_role`, check constraints.
- `clerk-nextjs-patterns`: `auth.protect()` in pages and server actions. Webhook routes are public and authenticated by provider signature or verification instead.
- No Paystack or OPay skill exists. Provider docs were used directly (see **Provider Reference**).

## Existing Code Inspected

- **Schema:** `subscriptions` already exists (`20261009000100_core_schema.sql`): `user_id unique`, `plan text default 'free'`, `status` check (`active | trialing | past_due | canceled | incomplete`), `provider_customer_id`, `provider_subscription_id unique`, `current_period_end`, `cancel_at_period_end`. RLS: select own, no writes for `authenticated`, `service_role` full (`20261009000200_rls_policies.sql`). `usage_events` exists and is written by `runStructured`. No payments table exists.
- `lib/ai/env.ts`: `AI_DAILY_GENERATION_LIMIT` (default 25) is one global cap. `readDailyGenerationLimit()` is used by `components/settings/ai-usage-section.tsx` and `components/dashboard/ai-usage-line.tsx`.
- `lib/ai/limits.ts` (`checkDailyLimit`), `lib/ai/run-structured.ts` (calls it with `config.dailyGenerationLimit`), `lib/ai/errors.ts` (`limit_reached` message), `lib/services/ai-usage.ts`.
- `lib/supabase/admin.ts` (service-role client for webhooks), `lib/supabase/server.ts` (`createUserClient`), `lib/services/current-user.ts`, `lib/services/users.ts`.
- `lib/observability/log.ts`: `logEvent` with safe fields only.
- `lib/schemas/enums.ts` (`subscriptionStatus`, `DB_ENUM_COLUMNS`) and `tests/db/schema-parity.test.ts`, which checks that the Zod enums match the DB check constraints.
- `lib/app-shell/nav-items.ts`, `components/app-shell/icons.tsx`, `app/app/settings/page.tsx`, `proxy.ts` (bare `clerkMiddleware`, whose matcher includes `/api`).
- `tests/db/helpers.ts` (PGlite, all migrations, role shim), `tests/services/fake-supabase.ts`.
- No `APP_URL`-style variable exists yet. There's no Stripe, Paystack or OPay code or dependency.

## Provider Reference (what the docs say, and where they disagree)

### Paystack (base `https://api.paystack.co`, `Authorization: Bearer <PAYSTACK_SECRET_KEY>`)
- Plans (monthly, NGN) are **created in the Paystack dashboard**, and their codes go in env (`PLN_…`).
- **Start:** `POST /transaction/initialize` with `{ email, amount (kobo), plan, reference, callback_url, metadata }`. Paystack charges the plan amount and creates a subscription after the first successful charge. It returns `authorization_url`, which the creator is redirected to.
- **Verify:** `GET /transaction/verify/:reference` returns `status`, `amount`, `currency`, `customer.customer_code`, `plan`.
- **Subscription:** `GET /subscription/:code` returns `status` (`active | non-renewing | attention | completed | cancelled`), `next_payment_date`, `email_token`, `plan.plan_code`, `customer.customer_code`. `GET /subscription?customer=<id>` lists a customer's subscriptions.
- **Cancel:** `POST /subscription/disable { code, token: email_token }`. **Manage card:** `GET /subscription/:code/manage/link`.
- **Webhooks:** header `x-paystack-signature` = hex HMAC-SHA512 of the **raw body** using the secret key. Paystack retries for up to 72h unless it gets a 200. Events used: `charge.success`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, `invoice.create`, `invoice.update`, `invoice.payment_failed`.

### OPay online Cashier (docs: `doc.opaycheckout.com`, not the offline/POS docs at `documentation.opayweb.com`)
- **Create:** `POST {base}/api/v1/international/cashier/create`, headers `Authorization: Bearer <OPAY_PUBLIC_KEY>`, `MerchantId`. Body: `{ reference, country: "NG", amount: { total (kobo), currency: "NGN" }, returnUrl, callbackUrl, cancelUrl, expireAt (minutes), product: { name, description }, userInfo? }`. Returns `code: "00000"` and `data.cashierUrl`, `orderNo`, `status`.
- **Status:** `POST {base}/api/v1/international/cashier/status` with body `{ reference, country }`, headers `Authorization: Bearer <hex HMAC-SHA512(body, OPAY_SECRET_KEY)>` and `MerchantId`. `data.status` is `INITIAL | PENDING | SUCCESS | FAIL | CLOSE`, plus `amount`.
- **Callback:** body `{ payload: { reference, status, amount, currency, transactionId, … }, sha512, type }`. Expects a 200 and retries for up to 72h.
- **Doc conflicts:** the callback signature is described as HMAC-SHA512 on one page and HMAC-**SHA3**-512 over a hand-built string on another. The base URLs (`testapi.` vs `sandboxapi.`, `liveapi.` vs `api.`) and the status-signing scheme (body only vs `RequestBody=…&RequestTimestamp=…`) also differ between pages. **Mitigation (decision 7):** the callback is never trusted. It only tells us to call the signed Status API, which is the source of truth. The base URL is an env var, and the status-signing scheme sits in one adapter function to confirm in sandbox.

## Decisions / Assumptions

1. **Plans** (`lib/billing/plans.ts`, one typed config). Prices and limits are **placeholders** that can be changed through env without code changes:

   | Plan | Daily AI generations (rolling 24h) | Price (NGN / month or 30-day pass) | Env overrides |
   |---|---|---|---|
   | `free` | 25 (unchanged from today) | 0 | `AI_DAILY_GENERATION_LIMIT` (keeps its meaning as the Free cap) |
   | `pro` | 100 | ₦5,000 | `AI_DAILY_GENERATION_LIMIT_PRO`, `BILLING_PRICE_PRO_NGN` |
   | `studio` | 300 | ₦15,000 | `AI_DAILY_GENERATION_LIMIT_STUDIO`, `BILLING_PRICE_STUDIO_NGN` |

   - Plan features differ **only in AI allowance** for now. Each plan card lists only what is actually true: "N AI generations per day" and "Everything in Free". There are no fake features.
   - **Studio is single-seat.** Team seats need Clerk Organizations and shared data, which this slice doesn't build, so the UI never says "team".
   - **Paystack price:** Paystack charges the amount set on the dashboard plan. The page shows the env price. The checkout service checks the plan amount from `GET /plan/:code` (cached for 10 minutes in memory) against the env price and **refuses checkout if they differ** (`price_mismatch`, logged), so a creator is never charged a different price from the one shown.
2. **Currency:** NGN only, on both providers. Paystack can take international cards in NGN if the Paystack account allows it. No USD pricing in this slice.
3. **Provider availability is env-gated.** A provider whose variables are missing is shown as "Not available yet" and disabled. Its actions return `not_configured`. Nothing pretends to work.
4. **Entitlement** (pure `resolveEntitlement(subscription, now)` in `lib/billing/entitlement.ts`): the effective plan is the row's `plan` when `status in ('active','trialing','past_due')` **and** (`current_period_end` is null or `> now`). Otherwise it's `free`. A missing row means `free`. `past_due` (a failed Paystack renewal) keeps access only until `current_period_end`. No extra grace period.
5. **Enforcement:** `runStructured` replaces `config.dailyGenerationLimit` with `getDailyLimitFor(db, userId, now)`. That reads the subscription with the service-role client, resolves the entitlement and returns the plan's cap. **If the subscription read fails, it falls back to the Free cap** (logged `billing_entitlement_read_failed`). Paying creators may briefly get the lower cap, but cost control never fails open. The Settings usage section and the dashboard usage line show the plan's cap and plan name through the same function, so they can't disagree with the enforced cap.
6. **One paid source at a time.** A creator with an active (unexpired) paid plan from one provider can't start a checkout on the other provider. The UI says "You're on Pro through Paystack. Cancel it first, or wait until it ends on <date>." (`provider_conflict`).
7. **Never trust the browser or the callback body.** Every state change comes from a server-side call to the provider: Paystack `transaction/verify` or `subscription/:code`, or the OPay Status API. Webhooks and return pages are only *triggers* to re-check. Paystack webhooks must also have a valid signature, or they're rejected with 401 and never processed. OPay callbacks are processed only for references that exist in `payments` and are still `pending`, which caps how many outbound status calls a forged callback can cause.
8. **Paystack lifecycle → `subscriptions`** (sync from `GET /subscription/:code` on every relevant event, never from the payload):

   | Paystack status | `status` | `cancel_at_period_end` | `current_period_end` |
   |---|---|---|---|
   | `active` | `active` | false | `next_payment_date` |
   | `non-renewing` | `active` | true | `next_payment_date` (the access end) |
   | `attention` (renewal failed) | `past_due` | false | unchanged |
   | `completed` / `cancelled` | `canceled` | true | unchanged (access stays until that date if it's in the future) |

   - **Finding the creator:** the first charge carries `metadata.user_id` (set by us at initialize), and the verified transaction gives `customer.customer_code`, which is stored on the payment and on `subscriptions.provider_customer_id`. Later subscription events are matched by `customer_code` → `subscriptions.provider_customer_id`. If no match yet (the event arrived before the first `charge.success` was processed), the webhook returns **500** so Paystack retries later.
   - `subscription.create` may arrive with no `charge.success` yet. In that case, list the customer's subscriptions only after the payment is matched.
   - Renewal `charge.success` / `invoice.update` events re-sync the subscription (which moves `current_period_end` forward). Renewals also insert a `payments` row (`kind: 'renewal'`, deduped by Paystack's transaction reference) so payment history is complete.
9. **Paystack plan change:** checking out a different paid plan while a Paystack subscription is active is allowed **only as an upgrade** (Pro → Studio). After the new subscription is confirmed, the old one is disabled through the API. The confirm dialog says: "Your Pro subscription stops now. Unused days aren't refunded." A downgrade (Studio → Pro) means cancelling, then subscribing to Pro after access ends. The UI explains this, and there's no proration.
10. **OPay pass application** (atomic, idempotent, in SQL RPC `apply_pass_payment(p_reference text)`, `security definer`, execute granted **only** to `service_role`):
    - `update payments set status='succeeded', applied_at=now() where provider='opay' and reference=p_reference and applied_at is null returning …`. If no row comes back, it's already applied and nothing else happens.
    - Same plan, still active: `current_period_end = current_period_end + 30 days` (stacking).
    - No active paid plan, or the pass is an upgrade (Pro → Studio): `plan = new plan`, `current_period_end = now() + 30 days`. Remaining Pro days are **not** carried over, and the UI warns about this before checkout.
    - A **downgrade pass** (buying Pro while Studio is active) is blocked at checkout (`downgrade_while_active`).
    - The row ends with `provider='opay'`, `status='active'`, `cancel_at_period_end=true`, and `provider_subscription_id=null`.
    - The amount from the Status API must equal the stored `amount_minor` with `currency = NGN`. Otherwise the payment is marked `failed` with `failure_reason='amount_mismatch'` and logged, and no pass is applied.
11. **Return pages:** `/app/billing/return?provider=…&reference=…` runs `auth.protect()`, checks that the reference belongs to the signed-in creator, runs the same verify/sync as the webhook (idempotent, so whichever comes first wins), then redirects to `/app/billing?checkout=success|pending|failed`. OPay `cancelUrl` goes to `/app/billing?checkout=cancelled`, and the pending row stays `pending`.
12. **Stale pending payments:** the billing page lists the creator's `pending` payments under 24h old with a **Check status** button, which re-runs verification (at most 1 check per payment per 30 seconds). Pending rows older than 24h are shown as **Expired** (computed, not stored). An automated reconciler is Phase 7 (background jobs) work.
13. **Cancel (Paystack):** a **Cancel subscription** button calls `subscription/disable`, then re-syncs (→ `canceled`, access until period end). It's confirmed through a dialog. **Update card** opens Paystack's manage link (generated server-side and opened in a new tab).
14. **OPay expiry reminder:** when an OPay pass ends within **5 days**, the billing page and the dashboard usage line show "Your Pro pass ends on <date>. Renew" with a link to `/app/billing`. There are no emails, since Resend isn't set up.
15. **`APP_URL`** (new, required for checkout) builds the return and callback URLs. Request `Host` headers are never used. If it's missing, checkout returns `not_configured`.
16. **No new npm dependencies:** `fetch` and `node:crypto` (`createHmac`, `timingSafeEqual`, `randomUUID`).
17. **Expiry runs at read time:** the entitlement is computed from `current_period_end` on every read, so nothing needs to run at expiry.
18. **`limit_reached` message** becomes: "You've reached today's AI generation limit for your plan. It frees up over the next 24 hours, or upgrade in Billing for more." The error UIs that show it already render the message, so a Billing link is added only where an action button already appears next to it.

## Database Changes

Migration `supabase/migrations/20261021000100_billing.sql`:

1. **`subscriptions`** (extend, don't replace):
   - `plan`: add check `plan in ('free','pro','studio')`.
   - `provider text check (provider in ('paystack','opay'))`, nullable (null = never paid).
   - `provider_plan_code text`, `provider_email_token text` (Paystack only; needed to disable the subscription; never sent to the browser. The creator's select policy can technically read it, so it's excluded from every query the UI uses. See Security).
   - `status`: unchanged set (`active, trialing, past_due, canceled, incomplete`).
2. **`payments`** (new, server-owned ledger):
   ```
   id uuid pk default gen_random_uuid()
   user_id text not null references users(id) on delete cascade
   provider text not null check (provider in ('paystack','opay'))
   kind text not null check (kind in ('subscription_start','renewal','pass'))
   plan text not null check (plan in ('pro','studio'))
   reference text not null            -- our reference (ch_<uuid>) or Paystack's for renewals
   provider_order_id text             -- OPay orderNo / Paystack transaction id
   provider_customer_id text          -- Paystack customer_code
   amount_minor bigint not null check (amount_minor > 0)   -- kobo
   currency text not null default 'NGN' check (currency = 'NGN')
   status text not null default 'pending' check (status in ('pending','succeeded','failed'))
   failure_reason text
   applied_at timestamptz
   last_checked_at timestamptz
   created_at, updated_at timestamptz not null default now()  (+ updated_at trigger like the other tables)
   unique (provider, reference)
   index (user_id, created_at desc)
   ```
3. **RLS:** `payments` has RLS enabled and forced. `authenticated` gets **select own** only (`user_id = auth.jwt()->>'sub'`), with no insert/update/delete. `service_role` gets all. `subscriptions` policies are unchanged (already read-only to the creator).
4. **RPC** `public.apply_pass_payment(p_reference text) returns jsonb` (decision 10): `security definer`, `set search_path = ''`, execute revoked from `public, anon, authenticated` and granted to `service_role`.
5. **Types:** update `lib/supabase/database.types.ts` (new table, columns and function). `lib/schemas/enums.ts` gets `subscriptionPlan`, `billingProvider`, `paymentKind` and `paymentStatus`, registered in `DB_ENUM_COLUMNS` so the schema-parity test covers them.
6. **Test helpers:** add `payments` to `CORE_TABLES` and seeds in `tests/db/helpers.ts`.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261021000100_billing.sql` (new) | Above |
| `lib/supabase/database.types.ts`, `lib/schemas/enums.ts` | Types / enums |
| `lib/billing/plans.ts` (new) | Plan config, env-overridable prices and limits, `readBillingConfig()` (which providers are configured) |
| `lib/billing/entitlement.ts` (new) | Pure `resolveEntitlement`, `passEndsSoon` |
| `lib/billing/paystack.ts` (new, `server-only`) | Adapter: `initializeTransaction`, `verifyTransaction`, `fetchSubscription`, `listCustomerSubscriptions`, `fetchPlan`, `disableSubscription`, `manageLink`, `verifyWebhookSignature`. Typed results (`{ok:false, code}`), Zod-parsed responses, 15s timeout, never throws |
| `lib/billing/opay.ts` (new, `server-only`) | Adapter: `createCashierPayment`, `queryCashierStatus`, `signStatusBody`. Same conventions |
| `lib/services/billing.ts` (new) | `getBillingOverview`, `startCheckout`, `confirmPayment(reference)`, `handlePaystackEvent`, `handleOpayCallback`, `cancelSubscription`, `getManageLink`, `getDailyLimitFor`. Dependencies are injected (db, adapters, now, env), so it's testable with fakes |
| `lib/ai/run-structured.ts`, `lib/ai/env.ts` | Plan-aware cap (decision 5). Add the `_PRO` / `_STUDIO` limit readers |
| `lib/ai/errors.ts` | `limit_reached` copy |
| `lib/services/ai-usage.ts`, `components/settings/ai-usage-section.tsx`, `components/dashboard/ai-usage-line.tsx` | Show plan name + plan cap, Billing link, pass-expiry note |
| `app/api/webhooks/paystack/route.ts` (new) | `POST`: raw body → signature check → `handlePaystackEvent` → 200 / 401 / 500 |
| `app/api/webhooks/opay/route.ts` (new) | `POST`: parse → `handleOpayCallback` → always 200 unless a transient error (500 to get a retry) |
| `app/app/billing/page.tsx`, `app/app/billing/actions.ts`, `app/app/billing/return/route.ts` (new) | Page, server actions (`startCheckoutAction`, `checkPaymentAction`, `cancelSubscriptionAction`, `manageCardAction`), return handler (`GET` route handler that redirects) |
| `components/billing/*` (new) | `current-plan-card.tsx`, `plan-cards.tsx`, `checkout-button.tsx` (client: pending state, confirm dialog for upgrades), `payment-history.tsx`, `checkout-notice-toast.tsx`, `cancel-subscription-control.tsx` |
| `lib/app-shell/nav-items.ts`, `components/app-shell/icons.tsx` | "Billing" item (bottom group, next to Settings) + `billing` icon |
| `lib/observability/log.ts` | Only if a new safe field is needed (e.g. `provider`); no ids or emails |
| `PHASES.md` | Tick Phase 6 items. Rename "Checkout (Stripe)" to "Checkout (Paystack + OPay)" with a note about the decision |
| `tests/…` | See Checks |

## Implementation Requirements

### Checkout (`startCheckoutAction(plan, provider)`)
1. `auth.protect()` → `userId`. Zod-validate `plan ∈ {pro, studio}`, `provider ∈ {paystack, opay}`. `ensureCurrentUser`.
2. Load billing config. Return `not_configured` if the provider or `APP_URL` is missing.
3. Load the current subscription → entitlement. Enforce decisions 6, 9 and 10 (`provider_conflict`, `already_on_plan` for the same Paystack plan, `downgrade_while_active`).
4. **Throttle:** at most **5 checkout starts per creator per hour**, counted from `payments.created_at` (`too_many_attempts`).
5. Insert a `payments` row: `pending`, `reference = "ch_" + randomUUID()` with dashes removed, `amount_minor = price × 100`, `kind = subscription_start | pass`.
6. **Paystack:** check that the plan amount matches (decision 1). `initializeTransaction({ email: Clerk primary email, amount, plan: planCode, reference, callback_url: APP_URL/app/billing/return?provider=paystack&reference=…, metadata: { user_id, plan, payment_id } })`. If there's no email, return `missing_email`.
   **OPay:** `createCashierPayment({ reference, country:"NG", amount:{ total, currency:"NGN" }, returnUrl: …/return?provider=opay&reference=…, cancelUrl: APP_URL/app/billing?checkout=cancelled, callbackUrl: APP_URL/api/webhooks/opay, expireAt: 30, product: { name: "CreateHive Pro — 30-day pass", description: "100 AI generations per day for 30 days" } })`. No `userInfo` is sent (data minimisation).
7. Store `provider_order_id` when there is one, then `redirect()` to `authorization_url` / `cashierUrl`. If the provider fails, mark the payment `failed` (`failure_reason = provider code`) and return a friendly error: "We couldn't open the payment page. Nothing was charged. Try again in a minute."

### `confirmPayment(reference)` (used by the return handler, Check status, and both webhooks)
- **Paystack:** `verifyTransaction`. On `success` with the matching amount and NGN currency: mark the payment `succeeded`, store `provider_customer_id`, upsert `subscriptions` (`provider='paystack'`, `provider_customer_id`). Then find the subscription (`listCustomerSubscriptions`, newest active one with the matching plan code) and sync it per decision 8. If the subscription doesn't exist yet, set `plan`, `status='active'`, `current_period_end = now + 30 days` provisionally. The `subscription.create` webhook later corrects it. If this was an upgrade, disable the previous subscription code. On `failed` / `abandoned`, mark the payment `failed`. Otherwise leave it `pending`.
- **OPay:** `queryCashierStatus`. On `SUCCESS`, call `apply_pass_payment` (after the amount check). On `FAIL` / `CLOSE`, mark it `failed` with `failureReason`. On `INITIAL` / `PENDING`, leave it pending.
- Always set `last_checked_at`. Return `{ status: 'succeeded' | 'pending' | 'failed' }`.

### Webhooks
- **Paystack route:** read `await request.text()` and verify `x-paystack-signature` with `timingSafeEqual` (equal-length check first). Invalid → 401, logged as `billing_webhook_rejected` (provider, code), no body echoed. Then `JSON.parse` + Zod (`{ event: string, data: object }`).
  - `charge.success`: if `data.reference` is one of our pending `payments`, `confirmPayment`. Otherwise it's a **renewal**: verify the transaction, match the customer, insert a `renewal` payment if it's new (unique constraint = idempotent), then re-sync the subscription.
  - `subscription.create | subscription.not_renew | subscription.disable | invoice.update | invoice.payment_failed | invoice.create`: take `data.subscription_code` (or `data.subscription.subscription_code`), `fetchSubscription`, sync (decision 8).
  - Unknown events → 200 and ignored.
  - Transient failures (DB or provider error, unmatched customer) → 500 so Paystack retries. Respond within the provider's timeout: no work beyond the calls above.
- **OPay route:** parse the JSON (failure → 200 + log, since retrying can't fix a malformed body). Take `payload.reference`. If it isn't a pending OPay payment → 200. Otherwise `confirmPayment`. A transient error → 500.
- Both routes: `export const dynamic`/runtime as the Next 16 docs require for route handlers under `cacheComponents` (read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before writing them). Node runtime (needs `node:crypto`). Never log bodies, emails, references or keys.

### Billing page (`/app/billing`)
- `PageHeader` (icon `billing`, "Billing", "Your plan, your AI allowance and your payments.").
- **Current plan card:** plan name, source ("Paystack · renews monthly", "OPay · 30-day pass", or "Free"), status line:
  - "Renews on 21 Nov 2026"
  - "Cancelled, active until 21 Nov 2026"
  - "Payment failed. Update your card by <date> to keep Pro" (`past_due`, with an **Update card** button)
  - "Pass ends 21 Nov 2026" (+ **Renew** when within 5 days)
  
  Also today's usage bar (reuses the settings bar) and the actions (Cancel subscription / Update card for Paystack).
- **Plan cards** (Free / Pro / Studio): price "₦5,000 / month", daily generations, "Current plan" badge. On each paid card, two buttons: **Pay with card**, with a small "Paystack · renews monthly" label, and **Pay with OPay**, with "30-day pass · renew when you like". A disabled button shows "Not available yet" when that provider isn't configured. Upgrades show the confirm dialog (decisions 9/10). Downgrade buttons are replaced by an explanation line.
- **Payment history:** the last 20 `payments`: date, plan, provider, amount (₦), status badge (Paid / Pending / Failed / Expired). Pending rows get **Check status**. Empty state: "No payments yet."
- **Checkout notice:** `?checkout=success|pending|failed|cancelled` → a toast (sonner, like `strategy-notice-toast.tsx`), then the query param is removed with `router.replace`.
- **States:** a section skeleton while loading; a failed load shows "We couldn't load your billing details. Refresh to try again." The plan cards still render from config.
- **Layout:** follows the existing app design system (`card`, `stack-*`, tokens; see `app-ui-*` prompts). Plan cards are a 3-column grid at ≥ `lg`, stacked on mobile, with full-width buttons on mobile. Prices use tabular numbers. Buttons show a pending state while redirecting (`useFormStatus`). There are no new animations beyond existing button and toast motion.

### Settings and dashboard
- The Settings "AI usage" section reads "**12 of 100** AI generations used in the last 24 hours (Pro plan)", with a "Manage plan" link to `/app/billing`.
- The dashboard usage line: "12 of 100 AI generations used · Pro · Details", plus the pass-expiry note (decision 14).

## Security Requirements

- Paystack secret key, OPay secret key, OPay public key and merchant id are **server-only env**. None use the `NEXT_PUBLIC_` prefix. The adapters import `server-only`.
- All writes to `subscriptions` and `payments` use the **service-role client inside the billing service only**. Creator-facing reads use `createUserClient()` (RLS). The creator can never write either table (tested).
- `provider_email_token`, `provider_customer_id` and `provider_order_id` are never selected into data sent to client components. Billing UI types list explicit columns.
- `userId` always comes from `auth.protect()`. The return handler checks that `payments.user_id === userId` before verifying. Otherwise it returns 404.
- Paystack webhooks require a valid HMAC signature (timing-safe). OPay callbacks are trigger-only (decision 7).
- Amounts and currency are checked against the stored payment before granting access.
- Idempotency: a unique `(provider, reference)`, `applied_at` guarded inside the RPC, and status syncs that are state-based (same input → same row).
- Logs: event names plus `provider`, `code`, `stage`, `db_code` only.
- **Data handling:** `payments` rows are deleted with the user (cascade). We store no card data, no names or phone numbers, and no emails in billing tables. The only personal data sent to a provider is the creator's email (Paystack requires it).

## Acceptance Criteria

1. The migration applies cleanly to PGlite and the schema-parity test passes with the new enums.
2. A creator can read only their own `payments` and `subscriptions`, and can't insert, update or delete either. They can't execute `apply_pass_payment`.
3. `apply_pass_payment` called twice with the same reference extends the pass once. A same-plan pass stacks 30 days. An upgrade resets to now + 30 days on the new plan.
4. `resolveEntitlement` covers: no row, active, non-renewing before/after the end, past_due before/after, canceled with a future end, expired OPay pass.
5. `runStructured` enforces the plan's cap (Free 25 / Pro 100 / Studio 300 by default) and falls back to Free if the subscription read fails.
6. A Paystack webhook with a bad or missing signature → 401 with no DB writes. A valid `charge.success` for a pending reference → payment `succeeded` + subscription `active` on the right plan. Replaying it changes nothing.
7. A Paystack `subscription.not_renew` / `disable` / `invoice.payment_failed` → state per decision 8, read from `fetchSubscription`, never from the payload.
8. An OPay callback for an unknown reference → 200, no provider call. For a pending reference with Status `SUCCESS` and the matching amount → the pass is applied. With a mismatched amount → `failed` and no pass.
9. Checkout is blocked with a clear message for: provider not configured, provider conflict, downgrade while active, too many attempts, Paystack price mismatch.
10. `/app/billing` renders every state: free, Paystack active / non-renewing / past_due, OPay pass (incl. ends soon), pending payment, empty history, and load error.
11. The Settings and dashboard usage numbers match the enforced cap.
12. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

New tests:
- `tests/db/billing.test.ts`: RLS on `payments` / `subscriptions` writes, RPC grants, RPC idempotency, stacking and upgrade math, constraints.
- `tests/billing/entitlement.test.ts`, `tests/billing/plans.test.ts` (env overrides, invalid values → defaults + log).
- `tests/billing/paystack.test.ts`: signature verification (valid, invalid, wrong length, empty), response parsing, error mapping (with a fetch stub).
- `tests/billing/opay.test.ts`: status-body signing (known vector from the openssl recipe in the docs), create/status parsing, error codes.
- `tests/services/billing.test.ts`: checkout guards, `confirmPayment` branches, webhook event handling and replay, renewal insert dedupe, the Free fallback in `getDailyLimitFor`.
- Update `tests/ai/run-structured.test.ts`, `tests/ai/models.test.ts` and `tests/services/ai-usage.test.ts` for the plan-aware cap.

## Manual Test Procedure

**Setup:** set `APP_URL` (an ngrok or Vercel preview URL, so the providers can reach the webhooks), `PAYSTACK_SECRET_KEY` (test `sk_test_…`), `PAYSTACK_PLAN_PRO`, `PAYSTACK_PLAN_STUDIO` (create two monthly NGN plans at ₦5,000 / ₦15,000 in the Paystack test dashboard), `OPAY_MERCHANT_ID`, `OPAY_PUBLIC_KEY`, `OPAY_SECRET_KEY` and `OPAY_BASE_URL=https://testapi.opaycheckout.com` (sandbox keys from the OPay Business dashboard). Set the Paystack webhook URL to `APP_URL/api/webhooks/paystack`. Apply the migration.

1. Sign in as a new creator → `/app/billing` shows Free, 25/day, and both providers enabled.
2. **Pay with card** on Pro → Paystack test checkout (card `4084 0840 8408 4081`, any future date, CVV 408) → back on `/app/billing` with a success toast, "Pro · Paystack · renews on …", and the usage cap at 100. The Settings and dashboard show 100.
3. In the Paystack dashboard, cancel the subscription → the webhook → the page shows "Cancelled, active until …".
4. Replay the webhook from the Paystack dashboard → nothing changes.
5. Send a POST to `/api/webhooks/paystack` with a fake signature → 401.
6. A second creator: **Pay with OPay** on Pro → OPay sandbox cashier → pay → returned → "Pass ends <today+30>". Buy another Pro pass → the end moves to +60 days.
7. Start an OPay checkout and close the cashier → "Payment cancelled" toast. The history shows Pending with **Check status**, and after 24h it shows Expired.
8. While on Paystack Pro, try **Pay with OPay** → blocked with the provider-conflict message.
9. Unset `OPAY_SECRET_KEY` → the OPay buttons show "Not available yet".
10. Use AI past the plan cap → the limit message mentions Billing.
11. Mobile width (375px): the plan cards stack and the buttons are full width. Nothing overflows horizontally.

**OPay sandbox confirmations (must be checked during step 6; the docs conflict):** the base URL host, the status-signing scheme (body-only HMAC-SHA512 vs `RequestBody=…&RequestTimestamp=…`), and that `amount.total` is in kobo. Each is one constant or function in `lib/billing/opay.ts`.

## Known Limitations (accepted for this slice)

- No proration or refunds. Upgrades forfeit the remaining time and the UI warns about it first.
- No automated reconciler for missed webhooks or abandoned payments (Phase 7). The return page and **Check status** cover the gap.
- No billing emails or receipts (Resend isn't set up). Paystack and OPay send their own receipts.
- No Stripe or USD pricing. No team seats.
- OPay passes don't auto-renew. That's a limitation of the provider.
