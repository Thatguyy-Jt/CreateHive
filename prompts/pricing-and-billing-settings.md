# Pricing page, realistic plans, and billing in Settings (Phase 6, part 2)

A follow-up to `prompts/billing-paystack-opay.md` (Phase 6, part 1: Paystack + OPay checkout, webhooks, `/app/billing`). The owner's feedback on part 1:

1. Visitors can't see plans before signing up.
2. Subscription management should live in **Settings**.
3. There's no **Upgrade to Pro** prompt near AI usage or when a limit is hit.
4. The plans aren't realistic: no creator uses 100–300 AI generations a day, so nobody would upgrade.
5. The billing UI should take ideas from the attached screenshot (plan cards with a highlighted dark paid card, a billing-history table with status dots and row actions).

**Owner decisions (2026-10-21):**
- **Per-feature monthly allowances** instead of a daily generation count.
- **Studio is removed entirely:** only Free and Pro.
- **Monthly billing only:** no Monthly/Yearly toggle.

## Goal

1. **Plans people can reason about.** Free and Pro differ in *how much of each AI feature* you get per month, plus one Pro-only feature (YouTube research). Non-AI features stay unlimited on both.
2. **A public `/pricing` page** linked in the main navigation, with clear calls to action ("Start free", "Get Pro"), a feature comparison, payment methods and billing FAQs.
3. **Billing moves into Settings** at `/app/settings/billing`. It covers the current subscription, payment details, plan change (upgrade), usage this month, billing history with receipts and CSV export, and cancellation, in a layout based on the screenshot.
4. **Upgrade prompts** next to AI usage on the dashboard, and wherever a Free creator hits a plan allowance.

## Skills Read

- `supabase`, `supabase-postgres-best-practices`: changing check constraints with a data migration, column additions, RLS unchanged.
- `clerk-nextjs-patterns`: `auth.protect()` per page, route handler and action. `redirect_url` on sign-up (the app's `<SignUp>` already lets an explicit `redirect_url` win).
- `emil-design-eng`: plan-card hierarchy, restraint and empty states for the billing UI.

## Existing Code Inspected

- **Part 1 billing:** `lib/billing/{plans,entitlement,allowance,plan-options,paystack,opay,http,errors,format,index}.ts`, `lib/services/billing.ts`, `app/app/billing/{page.tsx,actions.ts,return/route.ts}`, `app/api/webhooks/{paystack,opay}/route.ts`, `components/billing/*`, migration `20261021000100_billing.sql` (plan checks include `studio`).
- **AI service:** `lib/ai/run-structured.ts` (daily cap via `getAllowance` → plan `dailyGenerations`), `lib/ai/limits.ts` (`checkDailyLimit`: rolling window, provider failures excluded), `lib/ai/errors.ts` (`AiErrorCode`, `AI_ERRORS`), `lib/ai/prompts/registry.ts` (kinds: `creator_strategy`, `content_opportunities`, `weekly_plan`, `content_package`, `content_section`, `content_diagnosis`, `creator_insights`, `smoke_test`), `lib/ai/pricing.ts` (quality model $2 / $10 per MTok).
- **Feature services:** each returns `{ ok: false, code, message, retryable }`, and their error maps spread `AI_ERRORS`: `lib/services/{creator-strategy,opportunities,weekly-plan,studio,diagnosis,insights}.ts`. The actions forward `message` and `retryable`: `app/app/{strategy,opportunities,calendar,studio,analytics,insights}/actions.ts`. The controls render the error inline: `components/strategy/generate-strategy-control.tsx`, `components/opportunities/generate-opportunities-control.tsx`, `components/calendar/week-planner.tsx`, `components/studio/{generate-package-control,regenerate-section-form}.tsx`, `components/analytics/diagnose-control.tsx`, `components/insights/update-control.tsx`.
- **YouTube research:** `lib/services/youtube-refresh.ts` (`checkEligibility` → `YouTubeStatus` states), `components/research/{youtube-card,refresh-youtube-control}.tsx`.
- **Usage UI:** `components/settings/ai-usage-section.tsx`, `components/dashboard/ai-usage-line.tsx`, `lib/services/ai-usage.ts` (`getAiUsage`, `getPlanUsage`), `components/billing/usage-meter.tsx`.
- **Settings:** `app/app/settings/page.tsx` (Account, Timezone, AI usage, Privacy sections).
- **Navigation:** `lib/app-shell/nav-items.ts` (Billing item added in part 1), `lib/app-shell/breadcrumbs.ts` (`DETAIL_LABELS`).
- **Marketing:** `app/page.tsx`, `components/marketing/{site-header,site-footer,faq,final-cta,auth-actions}.tsx`, `lib/marketing/sample-data.ts` (`navLinks` are `#hash` anchors, `faqs`, an `announcement` saying the product is in early development).
- **Auth:** `app/sign-up/[[...sign-up]]/page.tsx` (`fallbackRedirectUrl="/onboarding"`, explicit `redirect_url` wins), `app/layout.tsx`.
- **Tests:** `tests/billing/*`, `tests/services/billing.test.ts`, `tests/db/billing.test.ts`, `tests/ai/run-structured.test.ts`, `tests/ai/fake-db.ts`, `tests/services/ai-usage.test.ts`, `tests/app-shell/*`.

## Decisions / Assumptions

### 1. The plans

Allowances count **uses in the last 30 days** (rolling, like the existing 24-hour count). This is the same rule the AI service uses: provider outages don't count, bad model output does. Copy says "per month" and "frees up as uses pass 30 days".

| Feature (AI kind) | Free | Pro |
|---|---|---|
| Strategy generations (`creator_strategy`) | 2 (first strategy + 1 refresh) | 6 |
| Idea batches (`content_opportunities`) | 4 (≈ weekly) | 20 |
| Content packages (`content_package`) | 5 | 30 |
| Section rewrites (`content_section`) | 15 | 100 |
| Post diagnoses (`content_diagnosis`) | 3 | 30 |
| Insights updates (`creator_insights`) | 2 | 8 |
| Weekly plan suggestions (`weekly_plan`) | 2 | 8 |
| YouTube research refresh | no | yes |
| Analytics, results entry, charts, calendar, Studio editing and version history, manual research signals | Unlimited | Unlimited |

- **Why these numbers:** Free covers about one post a week end to end, enough to see the loop work. Pro covers a creator posting 5–7 times a week, with a package and a diagnosis per post plus rewrites. The 30-day cost of maxing out every Pro allowance at today's quality-model prices is about **$8**. The estimate assumes about $0.07 per package, $0.05 per idea batch, $0.03 per section rewrite or diagnosis, and $0.09 per strategy. Typical use is a fraction of that. **Pro price placeholder: ₦9,000/month** (`BILLING_PRICE_PRO_NGN`); the owner should set the real price. Free's maximum cost is about $1.40 per creator per month.
- **The daily cap stays, but only as an abuse guard:** `AI_DAILY_GENERATION_LIMIT` (default 25) is the same on every plan and isn't shown as a plan feature. The per-plan daily limits from part 1 (`AI_DAILY_GENERATION_LIMIT_PRO`/`_STUDIO`, `dailyGenerations`) are removed.
- **Allowances are code constants** in `lib/billing/features.ts`, so the numbers are visible, reviewable and tested. **The price is env-configurable.**

### 2. Studio removal
- Code: `studio` is removed from enums, the catalog, entitlement, checkout rules, Paystack config (`PAYSTACK_PLAN_STUDIO`), copy and tests. Upgrade mode and `downgrade_while_active` are removed, since they can't happen with one paid plan.
- DB: a new migration converts any `studio` rows to `pro` (only possible in dev or test data), then replaces the plan checks with `subscriptions.plan in ('free','pro')` and `payments.plan in ('pro')`.
- The Paystack sync still handles "a new subscription replaces an old one" (a creator who resubscribes), so that logic stays.

### 3. Enforcement (`runStructured`)
After the daily abuse guard and before the pending row:
- Look up the allowance for this `kind` on the creator's plan (`smoke_test` has none).
- Count this creator's generations of this kind in the last 30 days with the same filter as `checkDailyLimit`. A new `checkMonthlyAllowance` lives in `lib/ai/limits.ts` and uses the existing `(user_id, created_at)` index plus `kind`.
- If the count is at the allowance:
  - Free plan → new code **`upgrade_required`**: "You've used this month's allowance for this on the Free plan. Upgrade to Pro for more, or wait for it to free up."
  - Pro plan → new code **`plan_limit`**: "You've used this month's allowance for this. It frees up as older uses pass 30 days."
- Both codes are `retryable: false`. A failed count **fails closed** (`persistence_error`), like the daily check.
- If the subscription read fails, the Free allowance is used. This is unchanged in spirit: cost control never fails open.

### 4. Upgrade prompts
- **Actions:** each AI action state gains `upgrade: boolean` (= `result.code === "upgrade_required"`). The seven controls listed above render a shared `<AiErrorAlert message upgrade />`, which shows the message plus an **Upgrade to Pro** button linking to `/app/settings/billing?plan=pro`.
- **YouTube research:** `checkEligibility` returns a new state `plan_required` for Free creators *before* any quota or API work. The card shows "YouTube research is included in Pro" with an **Upgrade to Pro** button. No API call is made.
- **Dashboard** (`ai-usage-line`): "3 of 5 content packages used this month · Free plan · **Upgrade to Pro**". For Pro, "12 of 30 content packages used this month · Pro". The OPay pass expiry note from part 1 is kept. Content packages are the headline metric because they're the core output.
- **Settings › General:** the "AI usage" section becomes **Plan & usage**: plan name, the content-package line, and links to **Manage billing** and (Free only) **Upgrade to Pro**. The full per-feature breakdown lives in Billing.

### 5. Public pricing page (`/pricing`)
- **Static and prerendered,** with no data. Plan data comes from `lib/billing/features.ts`, and the price comes from `readPlanCatalog()` at build time (a price change needs a redeploy, which is acceptable).
- **Nav:** `navLinks` becomes `/#how-it-works`, `/#features`, `/#creators`, `/#faq` and **`/pricing`**, so the hash links work from `/pricing` too. The header keeps **Get started** (sign-up), and the mobile menu includes Pricing. The footer gets a Pricing link.
- **Sections:**
  1. **Hero:** eyebrow "Pricing", headline "Start free. *Upgrade* when you're posting more.", a one-line lead, and a note: "Prices in naira. Cancel any time."
  2. **Plan cards (2):** Free (light) and Pro (dark ink card, "Most popular" is **not** used since there's no data for it; badge "PRO"). Each card has the price "/month", its CTA, and a checklist from the features table.
     - Free CTA: **Start free** → `/sign-up`.
     - Pro CTA: **Get Pro** → `/sign-up?redirect_url=/app/settings/billing?plan=pro`.
     - Signed-in visitors see **Go to billing** → `/app/settings/billing` (client hook, the same pattern as `AuthActions`, so the page stays static).
  3. **Comparison table:** every row of the table above, with ✓ / — / numbers, and a visible text alternative for icons. Mobile shows it as two stacked lists, not a horizontal scroll.
  4. **How you can pay:** "Card (Visa, Mastercard, Verve) through Paystack, renews monthly" and "OPay wallet, card, bank transfer or USSD: a 30-day pass you renew when you like". No logos (brand assets).
  5. **Billing FAQ (5):** What counts as a use? What happens when I reach a limit? Can I cancel? (Paystack: stops renewing, keep Pro to the period end. OPay: never auto-renews.) Do unused uses roll over? (No.) Is my card stored by CreateHive? (No: Paystack holds it; we only show its brand and last 4 digits.)
  6. **Final CTA:** "Start free" + "See how it works".
- **Honesty:** the page sits under the existing early-development announcement bar and makes no claims about features that don't exist. Every ✓ maps to a working feature.
- `metadata`: title "Pricing", plus a description.

### 6. Billing in Settings (`/app/settings/billing`)
- **Settings gets tabs:** **General** (`/app/settings`, the existing sections) and **Billing** (`/app/settings/billing`). They use the existing pill-tab style (`a.rounded-pill[aria-current="page"]`).
- **Moves:** the sidebar **Billing** item from part 1 is removed (Settings is the home). `/app/billing` becomes a `redirect("/app/settings/billing")` page. The return handler moves to **`/app/settings/billing/return`** and the checkout return URLs are updated. The webhook URLs are unchanged.
- **Breadcrumbs:** `/app/settings/billing` → "Settings › Billing". The receipt page → "Settings › Billing" as well.
- **Layout** (screenshot ideas adapted to our monochrome, border-defined system):
  1. **Header row:** "Billing & subscription" with "Manage your plan, payment details and receipts." There's no Monthly/Yearly toggle (monthly only).
  2. **Three-column card row (≥ `lg`; stacked on mobile):**
     - **Free** card (light): price ₦0, CTA area ("Current plan" as a disabled grey button when on Free; otherwise "Included when Pro ends"), feature checklist with check-circle icons.
     - **Pro** card (**dark ink card**, inverted text, a "PRO" pill in the accent colour), the screenshot's highlighted card. ₦9,000 /month. When on Free: **Upgrade with card** (white button, Paystack, "renews monthly") and **Pay with OPay** (outline-on-dark, "30-day pass"). When on Pro: "Current plan" plus, for OPay, **Add 30 days**. Blocked options show their reason (part 1 rules).
     - **Your subscription** card (replaces the screenshot's third plan card): status pill, the plan, renews/ends line, **payment method** ("Visa •••• 4081 · expires 09/28" from Paystack; "OPay · pay per pass"; "None" on Free), and actions: **Update card** (Paystack's hosted page) and **Cancel subscription** (Paystack, with confirm). On OPay: "Passes don't renew on their own."
  3. **Usage this month:** a card with one meter per AI feature ("3 of 5 content packages"), a 2-column grid at ≥ `md`, and YouTube research shown as "Included" / "Pro only". At-cap meters use the danger colour, and Free creators see an **Upgrade to Pro** link at the bottom.
  4. **Billing history table:** columns **Plan**, **Amount**, **Paid on**, **Covers until**, **Status** and **Action**.
     - **Covers until** is +30 days from payment for passes and the first/renewal month for Paystack, computed and shown only for paid rows. Otherwise it shows "—".
     - **Status** is a dot plus a text label: Paid (green dot), Pending (amber), Failed (red), Expired (grey). It's never colour alone.
     - **Action:** icon buttons with accessible labels: **View receipt** (eye) and **Download** (arrow; opens the receipt with the print dialog for "Save as PDF"). Pending rows get **Check status** instead.
     - Header controls: **Export CSV** (a real download of the creator's payment rows) and a **status filter** select (All / Paid / Pending / Failed), client-side over the 20 shown rows. The screenshot's free-text search is left out: with at most 20 rows a filter is enough.
     - Mobile: each row becomes a stacked card with the same fields.
     - Empty state: "No payments yet. When you upgrade, receipts will appear here."
- **Receipt page** (`/app/settings/billing/receipts/[id]`): server-rendered from the creator's own `payments` row (RLS + `user_id` check, otherwise 404). It shows CreateHive, a receipt number (the first 8 characters of the payment id, uppercase), date, plan, period covered, amount in ₦, payment method (Paystack / OPay), provider reference (`provider_order_id`) and status. Only paid payments have receipts, so others 404. It has a print stylesheet that hides the app shell and a **Print / Save as PDF** button, and `?print=1` opens the print dialog on load. Note: this is a payment receipt, not a tax invoice; the page says "Payment receipt".
- **CSV export** (`GET /app/settings/billing/export`): `auth.protect()`, RLS client, the creator's payments (up to 500). Columns: date, plan, type, provider, amount_ngn, status. `Content-Disposition: attachment; filename="createhive-payments.csv"`. Cells are CSV-escaped and formula-injection guarded (a leading `= + - @` is prefixed with `'`).
- **Card details:** the Paystack sync stores display-only card info from the subscription's `authorization` (`brand`, `last4`, `exp_month`, `exp_year`) in new `subscriptions` columns. This is allowed to display and isn't sensitive under PCI rules. Full card data never touches our systems. When Paystack omits it, the UI says "Card on file with Paystack".
- `?plan=pro` (from pricing and upgrade buttons) scrolls the Pro card into view and gives it a focus ring once.

### 7. Not changing
- Webhooks, provider adapters, payment confirmation, idempotency and RLS on `payments` stay as in part 1.
- No yearly billing, no team or Studio features, no proration.

## Database Changes

Migration `supabase/migrations/20261022000100_billing_free_pro.sql`:
1. `update public.subscriptions set plan = 'pro' where plan = 'studio';` and `update public.payments set plan = 'pro' where plan = 'studio';`
2. Drop and recreate `subscriptions_plan_check` → `plan in ('free','pro')`. Drop the inline `payments.plan` check (looked up by name in `pg_constraint`, or by the default name `payments_plan_check`) → `check (plan in ('pro'))`.
3. `alter table public.subscriptions add column card_brand text check (char_length(card_brand) <= 30), add column card_last4 text check (card_last4 ~ '^[0-9]{4}$'), add column card_exp text check (card_exp ~ '^[0-9]{2}/[0-9]{2}$');`
4. RLS and grants are unchanged. `apply_pass_payment` is unchanged; the OPay sync clears the card columns (set to null) in the RPC's upsert, through `create or replace function`.

Types: `database.types.ts` (new columns) and `lib/schemas/enums.ts` (`subscriptionPlan` → `free | pro`, `paidPlan` → `pro`). Schema parity covers both.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261022000100_billing_free_pro.sql` (new) | Above |
| `lib/supabase/database.types.ts`, `lib/schemas/enums.ts` | Types |
| `lib/billing/features.ts` (new) | `QUOTA_FEATURES` (kind, label, singular/plural noun), `PLAN_ALLOWANCES`, `PRO_ONLY = ["youtube_research"]`, `UNLIMITED_FEATURES` list for pricing |
| `lib/billing/plans.ts`, `entitlement.ts`, `allowance.ts`, `plan-options.ts`, `errors.ts`, `format.ts` | Remove Studio and per-plan daily limits; add `allowanceFor(plan, kind)` |
| `lib/ai/limits.ts`, `lib/ai/run-structured.ts`, `lib/ai/errors.ts` | `checkMonthlyAllowance`, `upgrade_required` / `plan_limit` |
| `lib/services/ai-usage.ts` | `getMonthlyUsage(client, userId)`: one grouped read of 30-day generations by kind (RLS client) → per-feature `{ used, limit }` |
| `lib/services/billing.ts`, `lib/billing/paystack.ts` | Studio removal, card details in the sync, return URL path, `listPaymentsForExport`, `getReceipt` |
| `lib/services/youtube-refresh.ts`, `components/research/youtube-card.tsx` | `plan_required` state |
| 6 action files + 7 controls + `components/ai/ai-error-alert.tsx` (new) | `upgrade` flag and the shared alert |
| `app/pricing/page.tsx` (new), `components/pricing/*` (new) | Public pricing page |
| `lib/marketing/sample-data.ts`, `components/marketing/site-header.tsx`, `site-footer.tsx` | Pricing in nav and footer; absolute hash links |
| `app/app/settings/layout.tsx` (new), `components/settings/settings-tabs.tsx` (new) | General / Billing tabs |
| `app/app/settings/billing/{page.tsx,return/route.ts,export/route.ts,receipts/[id]/page.tsx}` (new) | Billing in Settings |
| `app/app/billing/page.tsx` → redirect; `app/app/billing/return/route.ts`, `actions.ts` | Moved under settings |
| `components/billing/*` | Rebuilt per §6 (plan cards, subscription card, usage grid, history table, receipt) |
| `components/settings/ai-usage-section.tsx`, `components/dashboard/ai-usage-line.tsx` | Plan & usage, Upgrade to Pro |
| `lib/app-shell/nav-items.ts`, `components/app-shell/icons.tsx`, `lib/app-shell/breadcrumbs.ts` | Remove the sidebar Billing item; add `check-circle`, `eye`, `download` icons; settings crumbs |
| `app/globals.css` | Dark plan card tokens, status dots, receipt print styles |
| `PHASES.md` | Note the part 2 changes under Phase 6 |
| Tests | See Checks |

## AI Behavior
- No prompt or model changes.
- **Input/output:** unchanged.
- **Usage controls:** a per-kind 30-day allowance by plan (above), plus the unchanged daily abuse guard. Failed counts fail closed.
- **Error handling:** two new stable codes with fixed copy. Nothing about the creator or the model leaks into messages or logs.

## Security Requirements
- `/pricing` is public and static, with no data. Every `/app/settings/billing*` page, route handler and action calls `auth.protect()`.
- The receipt page and CSV export read with the **creator's RLS client** and check `user_id`. Another creator's id → 404.
- CSV formula-injection guard. No provider tokens are selected for any page. The card columns are display-only (brand, last 4, expiry).
- The upgrade link's `?plan=pro` only affects scroll and focus. It never starts a checkout.
- `redirect_url` on sign-up is a fixed internal path (no open redirect: it's a constant, not user input).

## Acceptance Criteria
1. `/pricing` is prerendered, linked from the header (desktop and mobile) and footer, and shows Free and Pro with the exact allowances from `lib/billing/features.ts`, the price from the catalog, the comparison, payment methods and the FAQ. "Start free" → `/sign-up`; "Get Pro" → `/sign-up?redirect_url=…/app/settings/billing?plan=pro`; signed-in users see "Go to billing".
2. Nothing in the code, UI or database mentions or accepts `studio`. The migration converts existing rows and the parity test passes.
3. A Free creator's 6th content package in 30 days returns `upgrade_required` without calling the model, and the Studio control shows the message with **Upgrade to Pro**. A Pro creator's 31st returns `plan_limit` with no upgrade button. Provider failures don't count. A failed count returns `persistence_error`.
4. Free creators can't refresh YouTube research (`plan_required`, no API call). Pro creators can, subject to the existing limits.
5. The dashboard shows content-package usage, the plan, and **Upgrade to Pro** for Free.
6. `/app/settings` has General and Billing tabs. `/app/billing` redirects to `/app/settings/billing`. The sidebar has no separate Billing item.
7. The Billing tab shows the three-card row, per-feature usage, the history table (filter + Export CSV + receipt actions) and cancel/update card for Paystack, at both desktop and 375px widths.
8. A receipt renders only for the owner's paid payments and prints without the app shell. The CSV downloads with escaped cells.
9. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Checks
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
New and updated tests:
- `tests/billing/features.test.ts`: every AI kind except `smoke_test` has a Free and a Pro allowance, and Pro ≥ Free for every feature.
- `tests/ai/run-structured.test.ts`: `upgrade_required` vs `plan_limit`, provider-failure exclusion on the monthly count, fail-closed count, no model call at the limit.
- `tests/services/ai-usage.test.ts`: `getMonthlyUsage` grouping and limits per plan.
- `tests/services/youtube-refresh.test.ts`: `plan_required` for Free, with no quota reads or API calls.
- `tests/services/billing.test.ts` and `tests/billing/plans.test.ts`: updated for Free/Pro, card details synced, export rows, receipt ownership.
- `tests/billing/csv.test.ts`: escaping and the formula guard.
- `tests/db/billing.test.ts`: `studio` rejected, rows converted, card column checks.
- `tests/app-shell/*`: nav and breadcrumbs.

## Manual Test Procedure
1. Signed out, open `/`: the header shows **Pricing** and **Get started**. Click Pricing. Check the cards, the comparison table (and that it stacks at 375px), the payment methods and the FAQ. "Get Pro" → sign-up → after sign-up you land on Settings › Billing with the Pro card focused.
2. Signed in, on the dashboard: the usage line shows "0 of 5 content packages used this month · Free plan · Upgrade to Pro".
3. As Free, create 5 content packages, then try a 6th: you see the message and **Upgrade to Pro** → Billing. On Research, the YouTube card says it's included in Pro.
4. Settings › Billing: pay with the Paystack test card (`4084 0840 8408 4081`). You return to Billing with a success toast, the Pro card shows "Current plan", and the subscription card shows the card brand and last 4 and "Renews on …". The history row shows **Paid**, with View receipt, Download and Export CSV working.
5. Cancel the subscription: confirm, then "Cancelled, active until …".
6. A second account pays with OPay: "Pass ends …" and **Add 30 days**. The history shows a 30-day "Covers until".
7. Visit `/app/billing`: it redirects to Settings › Billing.
8. Try another creator's receipt id: 404.

### Visual expectations
- **Plan row:** equal-height cards with a 16px gap, the Pro card in `--ink` with surface text, and the CTA directly under the price (as in the screenshot). The checklist uses a 20px check-circle icon, 14px text and 12px row gap.
- **Status:** an 8px dot plus a semibold label in the status colour, with the text meeting AA contrast.
- **History table:** a muted header row, 56px row height, right-aligned icon buttons (36px, labelled), and tabular numbers for amounts.
- **Motion:** no new animation beyond existing button and toast motion. The `?plan=pro` focus ring respects reduced motion (no smooth scroll).
- **Loading:** the existing section skeletons. **Errors:** the existing card-level "couldn't load" pattern, with the plan cards still shown from config.
