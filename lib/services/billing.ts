import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  checkoutDecision,
  resolveEntitlement,
  SUBSCRIPTION_STATE_COLUMNS,
  type Entitlement,
  type SubscriptionState,
} from "@/lib/billing/entitlement";
import type { BillingErrorCode } from "@/lib/billing/errors";
import type { PaystackClient, PaystackSubscription } from "@/lib/billing/paystack";
import { planForPaystackCode, toKobo, type BillingConfig, type PlanCatalog } from "@/lib/billing/plans";
import { logEvent } from "@/lib/observability/log";
import type { BillingProvider, PaidPlan, PaymentKind, PaymentStatus, SubscriptionStatus } from "@/lib/schemas/enums";
import type { Database } from "@/lib/supabase/database.types";

// Billing application service. Every write to `subscriptions` and `payments`
// happens here, with the service-role client, and only from data the server
// fetched from the provider itself. Webhooks, return pages and "Check status"
// are all just triggers to re-check: callback bodies are never trusted.

export type BillingDb = Pick<SupabaseClient<Database>, "from" | "rpc">;
export type BillingReadDb = Pick<SupabaseClient<Database>, "from">;

export interface BillingDeps {
  /** Service-role client: both billing tables are server-owned. */
  db: BillingDb;
  config: BillingConfig;
  plans: PlanCatalog;
  paystack: PaystackClient | null;
  now: () => number;
}

type Fail = { ok: false; code: BillingErrorCode };
const fail = (code: BillingErrorCode): Fail => ({ ok: false, code });

const DAY_MS = 24 * 60 * 60 * 1000;
export const CHECKOUT_WINDOW_MS = 60 * 60 * 1000;
export const MAX_CHECKOUTS_PER_WINDOW = 5;
export const PENDING_EXPIRY_MS = DAY_MS;
export const CHECK_COOLDOWN_MS = 30_000;
const PLAN_CACHE_MS = 10 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";

const PAYMENT_COLUMNS =
  "id, user_id, provider, kind, plan, reference, amount_minor, currency, status, applied_at, last_checked_at, created_at";

interface PaymentRow {
  id: string;
  user_id: string;
  provider: string;
  kind: string;
  plan: string;
  reference: string;
  amount_minor: number;
  currency: string;
  status: string;
  applied_at: string | null;
  last_checked_at: string | null;
  created_at: string;
}

type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

const log = logEvent;

// ---------------------------------------------------------------------------
// Overview (creator client, RLS)
// ---------------------------------------------------------------------------

export type PaymentDisplayStatus = PaymentStatus | "expired";

export interface PaymentView {
  id: string;
  provider: BillingProvider;
  kind: PaymentKind;
  plan: PaidPlan;
  amountMinor: number;
  status: PaymentDisplayStatus;
  createdAt: string;
  /** When it was paid (succeeded payments only). */
  paidAt: string | null;
  /** The end of the period it paid for (succeeded payments only). */
  coversUntil: string | null;
}

export interface CardOnFile {
  brand: string;
  last4: string;
  exp: string | null;
}

export interface BillingOverview {
  entitlement: Entitlement;
  /** Raw status, for the "payment failed" and "cancelled" lines. */
  subscriptionStatus: SubscriptionStatus | null;
  /** Paystack card on file, display-only. */
  card: CardOnFile | null;
  payments: PaymentView[];
}

/** Pending for more than a day: the checkout was abandoned. Computed, never stored. */
export function displayStatus(status: string, createdAt: string, now: number): PaymentDisplayStatus {
  if (status === "pending" && now - Date.parse(createdAt) > PENDING_EXPIRY_MS) return "expired";
  return status as PaymentStatus;
}

/** The period a paid payment covers: one calendar month. */
export function coversUntil(paidAt: string | null): string | null {
  if (!paidAt) return null;
  const start = new Date(paidAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

const PAYMENT_VIEW_COLUMNS = "id, provider, kind, plan, amount_minor, status, created_at, applied_at";

interface PaymentViewRow {
  id: string;
  provider: string;
  kind: string;
  plan: string;
  amount_minor: number;
  status: string;
  created_at: string;
  applied_at: string | null;
}

function toPaymentView(p: PaymentViewRow, now: number): PaymentView {
  const paidAt = p.status === "succeeded" ? (p.applied_at ?? p.created_at) : null;
  return {
    id: p.id,
    provider: p.provider as BillingProvider,
    kind: p.kind as PaymentKind,
    plan: p.plan as PaidPlan,
    amountMinor: p.amount_minor,
    status: displayStatus(p.status, p.created_at, now),
    createdAt: p.created_at,
    paidAt,
    coversUntil: coversUntil(paidAt),
  };
}

/**
 * The creator's plan, card on file and last 20 payments. Pass a client acting
 * as the creator: RLS limits every read to their own rows. Selects explicit
 * columns, so provider tokens never reach a page.
 */
export async function getBillingOverview(
  client: BillingReadDb,
  userId: string,
  now: number,
): Promise<{ ok: true; overview: BillingOverview } | { ok: false }> {
  try {
    const [subscription, payments] = await Promise.all([
      client
        .from("subscriptions")
        .select(`${SUBSCRIPTION_STATE_COLUMNS}, card_brand, card_last4, card_exp`)
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("payments")
        .select(PAYMENT_VIEW_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (subscription.error || payments.error) {
      log("error", "billing_overview_failed", {
        stage: "select",
        db_code: subscription.error?.code ?? payments.error?.code,
      });
      return { ok: false };
    }
    const row = (subscription.data as (SubscriptionState & { card_brand: string | null; card_last4: string | null; card_exp: string | null }) | null) ?? null;
    const entitlement = resolveEntitlement(row, now);
    return {
      ok: true,
      overview: {
        entitlement,
        subscriptionStatus: (row?.status as SubscriptionStatus | undefined) ?? null,
        card:
          entitlement.provider === "paystack" && row?.card_brand && row.card_last4
            ? { brand: row.card_brand, last4: row.card_last4, exp: row.card_exp }
            : null,
        payments: ((payments.data ?? []) as PaymentViewRow[]).map((p) => toPaymentView(p, now)),
      },
    };
  } catch (error) {
    log("error", "billing_overview_failed", { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
    return { ok: false };
  }
}

export interface Receipt extends PaymentView {
  /** First 8 characters of the payment id, uppercase. */
  number: string;
  /** Paystack transaction id. */
  providerReference: string | null;
}

/** One of the creator's paid payments, for its receipt page. RLS client. Null if not theirs or not paid. */
export async function getReceipt(
  client: BillingReadDb,
  userId: string,
  paymentId: string,
  now: number = Date.now(),
): Promise<{ ok: true; receipt: Receipt | null } | { ok: false }> {
  try {
    const { data, error } = await client
      .from("payments")
      .select(`${PAYMENT_VIEW_COLUMNS}, provider_order_id`)
      .eq("id", paymentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      log("error", "billing_receipt_failed", { stage: "select", db_code: error.code });
      return { ok: false };
    }
    const row = data as (PaymentViewRow & { provider_order_id: string | null }) | null;
    if (!row || row.status !== "succeeded") return { ok: true, receipt: null };
    return {
      ok: true,
      receipt: {
        ...toPaymentView(row, now),
        number: row.id.replaceAll("-", "").slice(0, 8).toUpperCase(),
        providerReference: row.provider_order_id,
      },
    };
  } catch (error) {
    log("error", "billing_receipt_failed", { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
    return { ok: false };
  }
}

export const EXPORT_LIMIT = 500;

/** The creator's payments for CSV export, newest first. RLS client. */
export async function listPaymentsForExport(
  client: BillingReadDb,
  userId: string,
  now: number,
): Promise<{ ok: true; payments: PaymentView[] } | { ok: false }> {
  try {
    const { data, error } = await client
      .from("payments")
      .select(PAYMENT_VIEW_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(EXPORT_LIMIT);
    if (error) {
      log("error", "billing_export_failed", { stage: "select", db_code: error.code });
      return { ok: false };
    }
    return { ok: true, payments: ((data ?? []) as PaymentViewRow[]).map((p) => toPaymentView(p, now)) };
  } catch (error) {
    log("error", "billing_export_failed", { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface CheckoutRequest {
  /** From Clerk's verified session only. */
  userId: string;
  /** Creator's primary email (Paystack requires one). */
  email: string | null;
  plan: PaidPlan;
}

export type CheckoutResult = { ok: true; url: string } | Fail;

const planCache = new Map<string, { at: number; amountMinor: number; currency: string }>();

/** Clears the in-memory Paystack plan cache (tests). */
export function resetPlanCache() {
  planCache.clear();
}

async function paystackPlanMatches(deps: BillingDeps, plan: PaidPlan, amountMinor: number): Promise<boolean | null> {
  const code = deps.config.paystack!.planCodes[plan];
  const cached = planCache.get(code);
  let info = cached && deps.now() - cached.at < PLAN_CACHE_MS ? cached : null;
  if (!info) {
    const fetched = await deps.paystack!.fetchPlan(code);
    if (!fetched.ok) {
      log("error", "billing_provider_failed", { provider: "paystack", stage: "fetch_plan", code: fetched.code });
      return null;
    }
    info = { at: deps.now(), ...fetched.data };
    planCache.set(code, info);
  }
  return info.amountMinor === amountMinor && info.currency === "NGN";
}

export async function startCheckout(deps: BillingDeps, request: CheckoutRequest): Promise<CheckoutResult> {
  const { userId, plan } = request;
  const provider = "paystack";
  const { appUrl } = deps.config;
  if (!appUrl || !deps.paystack || !deps.config.paystack) return fail("not_configured");

  try {
    const current = await deps.db
      .from("subscriptions")
      .select(SUBSCRIPTION_STATE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error) {
      log("error", "billing_checkout_failed", { provider, stage: "subscription", db_code: current.error.code });
      return fail("persistence_error");
    }
    const entitlement = resolveEntitlement((current.data as SubscriptionState | null) ?? null, deps.now());
    const decision = checkoutDecision(entitlement);
    if (!decision.allowed) return fail(decision.code);

    const since = new Date(deps.now() - CHECKOUT_WINDOW_MS).toISOString();
    const recent = await deps.db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if (recent.error || recent.count === null) {
      log("error", "billing_checkout_failed", { provider, stage: "throttle", db_code: recent.error?.code });
      return fail("persistence_error");
    }
    if (recent.count >= MAX_CHECKOUTS_PER_WINDOW) return fail("too_many_attempts");

    const amountMinor = toKobo(deps.plans[plan].priceNaira);

    if (!request.email) return fail("missing_email");
    const matches = await paystackPlanMatches(deps, plan, amountMinor);
    if (matches === null) return fail("provider_error");
    if (!matches) {
      log("error", "billing_price_mismatch", { provider, kind: plan });
      return fail("price_mismatch");
    }

    const reference = `ch_${randomUUID().replaceAll("-", "")}`;
    const inserted = await deps.db
      .from("payments")
      .insert({
        user_id: userId,
        provider,
        kind: "subscription_start",
        plan,
        reference,
        amount_minor: amountMinor,
        currency: "NGN",
        status: "pending",
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      log("error", "billing_checkout_failed", { provider, stage: "insert", db_code: inserted.error?.code });
      return fail("persistence_error");
    }
    const paymentId = inserted.data.id;

    const returnUrl = `${appUrl}/app/settings/billing/return?provider=${provider}&reference=${reference}`;
    const started = await deps.paystack.initializeTransaction({
      email: request.email,
      amountMinor,
      planCode: deps.config.paystack.planCodes[plan],
      reference,
      callbackUrl: returnUrl,
      metadata: { user_id: userId, plan, payment_id: paymentId },
    });

    if (!started.ok) {
      log("error", "billing_provider_failed", { provider, stage: "start", code: started.code });
      await deps.db
        .from("payments")
        .update({ status: "failed", failure_reason: started.code.slice(0, 200) })
        .eq("id", paymentId);
      return fail("provider_error");
    }

    return { ok: true, url: started.data.authorizationUrl };
  } catch (error) {
    log("error", "billing_checkout_failed", {
      provider,
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Confirming payments
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { ok: true; status: PaymentStatus }
  /** `transient`: worth retrying (webhooks answer 500 so the provider retries). */
  | { ok: false; transient: boolean };

const RETRY: ConfirmResult = { ok: false, transient: true };
const GIVE_UP: ConfirmResult = { ok: false, transient: false };

async function findPayment(db: BillingDb, provider: BillingProvider, reference: string) {
  return db.from("payments").select(PAYMENT_COLUMNS).eq("provider", provider).eq("reference", reference).maybeSingle();
}

async function markFailed(db: BillingDb, paymentId: string, reason: string, now: number) {
  const { error } = await db
    .from("payments")
    .update({ status: "failed", failure_reason: reason.slice(0, 200), last_checked_at: new Date(now).toISOString() })
    .eq("id", paymentId)
    .eq("status", "pending");
  return !error;
}

async function markChecked(db: BillingDb, paymentId: string, now: number) {
  await db.from("payments").update({ last_checked_at: new Date(now).toISOString() }).eq("id", paymentId);
}

/**
 * Asks the provider what happened to one of our payments and applies it.
 * Idempotent: a payment that already succeeded or failed is returned as is.
 */
export async function confirmPayment(deps: BillingDeps, payment: PaymentRow): Promise<ConfirmResult> {
  if (payment.status !== "pending") return { ok: true, status: payment.status as PaymentStatus };
  return confirmPaystack(deps, payment);
}

const PAYSTACK_FAILED = new Set(["failed", "reversed"]);

async function confirmPaystack(deps: BillingDeps, payment: PaymentRow): Promise<ConfirmResult> {
  if (!deps.paystack || !deps.config.paystack) return GIVE_UP;
  const now = deps.now();
  const verified = await deps.paystack.verifyTransaction(payment.reference);
  if (!verified.ok) {
    log("error", "billing_provider_failed", { provider: "paystack", stage: "verify", code: verified.code });
    await markChecked(deps.db, payment.id, now);
    return verified.transient ? RETRY : GIVE_UP;
  }
  const tx = verified.data;

  if (PAYSTACK_FAILED.has(tx.status)) {
    await markFailed(deps.db, payment.id, tx.status, now);
    return { ok: true, status: "failed" };
  }
  if (tx.status !== "success") {
    await markChecked(deps.db, payment.id, now);
    return { ok: true, status: "pending" };
  }
  if (tx.amountMinor !== payment.amount_minor || tx.currency !== "NGN") {
    log("error", "billing_amount_mismatch", { provider: "paystack" });
    await markFailed(deps.db, payment.id, "amount_mismatch", now);
    return { ok: true, status: "failed" };
  }

  const nowIso = new Date(now).toISOString();
  const marked = await deps.db
    .from("payments")
    .update({
      status: "succeeded",
      applied_at: nowIso,
      last_checked_at: nowIso,
      provider_customer_id: tx.customerCode,
      provider_order_id: tx.id,
    })
    .eq("id", payment.id);
  if (marked.error) {
    log("error", "billing_apply_failed", { provider: "paystack", stage: "payment", db_code: marked.error.code });
    return RETRY;
  }

  // Prefer the real subscription; Paystack usually creates it right after the charge.
  const plan = payment.plan as PaidPlan;
  const listed = await deps.paystack.listSubscriptions(tx.customerId);
  const match = listed.ok
    ? listed.data
        .filter((s) => s.planCode === deps.config.paystack!.planCodes[plan] && LIVE_PAYSTACK.has(s.status))
        .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0]
    : undefined;
  if (match) {
    const synced = await syncPaystackSubscription(deps, payment.user_id, match);
    return synced ? { ok: true, status: "succeeded" } : RETRY;
  }

  // Not created yet: grant the plan for a month now; `subscription.create` corrects it.
  // The previous subscription code (an upgrade) is kept so the sync can disable it.
  const provisional = await deps.db.from("subscriptions").upsert(
    {
      user_id: payment.user_id,
      plan,
      status: "active",
      provider: "paystack",
      provider_customer_id: tx.customerCode,
      provider_plan_code: deps.config.paystack.planCodes[plan],
      current_period_end: new Date(now + 30 * DAY_MS).toISOString(),
      cancel_at_period_end: false,
    },
    { onConflict: "user_id" },
  );
  if (provisional.error) {
    log("error", "billing_apply_failed", { provider: "paystack", stage: "provisional", db_code: provisional.error.code });
    return RETRY;
  }
  return { ok: true, status: "succeeded" };
}

// ---------------------------------------------------------------------------
// Paystack subscription sync
// ---------------------------------------------------------------------------

const LIVE_PAYSTACK = new Set(["active", "non-renewing"]);

interface MappedStatus {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  /** Take `current_period_end` from `next_payment_date`. */
  useNextDate: boolean;
}

export function mapPaystackStatus(status: string): MappedStatus | null {
  switch (status) {
    case "active":
      return { status: "active", cancelAtPeriodEnd: false, useNextDate: true };
    case "non-renewing":
      return { status: "active", cancelAtPeriodEnd: true, useNextDate: true };
    case "attention":
      return { status: "past_due", cancelAtPeriodEnd: false, useNextDate: false };
    case "completed":
    case "cancelled":
      return { status: "canceled", cancelAtPeriodEnd: true, useNextDate: false };
    default:
      return null;
  }
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Writes the creator's `subscriptions` row from a subscription fetched from
 * Paystack. State-based, so replays are harmless. Returns false on a DB error.
 */
export async function syncPaystackSubscription(
  deps: BillingDeps,
  userId: string,
  subscription: PaystackSubscription,
): Promise<boolean> {
  const config = deps.config.paystack;
  if (!config) return true;
  const plan = planForPaystackCode(config, subscription.planCode);
  const mapped = mapPaystackStatus(subscription.status);
  if (!plan || !mapped) {
    // Not one of our plans, or a status we don't know: nothing to change.
    log("warn", "billing_paystack_ignored", { provider: "paystack", stage: plan ? "status" : "plan", code: subscription.status });
    return true;
  }

  const existing = await deps.db.from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
  if (existing.error) {
    log("error", "billing_sync_failed", { provider: "paystack", stage: "select", db_code: existing.error.code });
    return false;
  }
  const row = existing.data as SubscriptionRow | null;

  if (row?.provider === "paystack" && row.provider_subscription_id && row.provider_subscription_id !== subscription.code) {
    // An event about a subscription other than the current one.
    if (!LIVE_PAYSTACK.has(subscription.status)) return true; // e.g. the old plan being disabled after an upgrade
    // A new live subscription replaces the old one (an upgrade): stop the old one charging.
    if (row.status !== "canceled" && row.provider_email_token && deps.paystack) {
      const disabled = await deps.paystack.disableSubscription(row.provider_subscription_id, row.provider_email_token);
      if (!disabled.ok) log("error", "billing_provider_failed", { provider: "paystack", stage: "disable_old", code: disabled.code });
    }
  }

  const nextDate = mapped.useNextDate ? isoOrNull(subscription.nextPaymentDate) : null;
  const upserted = await deps.db.from("subscriptions").upsert(
    {
      user_id: userId,
      plan,
      status: mapped.status,
      provider: "paystack",
      provider_customer_id: subscription.customerCode,
      provider_subscription_id: subscription.code,
      provider_plan_code: subscription.planCode,
      provider_email_token: subscription.emailToken,
      // Keep what we have when Paystack omits the authorization.
      ...(subscription.card
        ? { card_brand: subscription.card.brand, card_last4: subscription.card.last4, card_exp: subscription.card.exp }
        : {}),
      cancel_at_period_end: mapped.cancelAtPeriodEnd,
      // Without a next date, keep the period we already know about (access runs to it).
      current_period_end: nextDate ?? row?.current_period_end ?? null,
    },
    { onConflict: "user_id" },
  );
  if (upserted.error) {
    log("error", "billing_sync_failed", { provider: "paystack", stage: "upsert", db_code: upserted.error.code });
    return false;
  }
  return true;
}

async function findUserForCustomer(db: BillingDb, customerCode: string): Promise<string | null | "error"> {
  const sub = await db
    .from("subscriptions")
    .select("user_id")
    .eq("provider_customer_id", customerCode)
    .limit(1)
    .maybeSingle();
  if (sub.error) return "error";
  if (sub.data) return sub.data.user_id;
  const paid = await db
    .from("payments")
    .select("user_id")
    .eq("provider", "paystack")
    .eq("provider_customer_id", customerCode)
    .limit(1)
    .maybeSingle();
  if (paid.error) return "error";
  return paid.data?.user_id ?? null;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookOutcome = { status: 200 | 500 };
const OK: WebhookOutcome = { status: 200 };
const RETRY_LATER: WebhookOutcome = { status: 500 };

export const paystackEventSchema = z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }).loose();
export type PaystackEvent = z.infer<typeof paystackEventSchema>;

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.create",
  "subscription.not_renew",
  "subscription.disable",
  "subscription.expiring_cards",
]);
const INVOICE_EVENTS = new Set(["invoice.create", "invoice.update", "invoice.payment_failed"]);

function subscriptionCodeOf(event: PaystackEvent): string | null {
  const data = event.data;
  if (typeof data.subscription_code === "string") return data.subscription_code;
  const nested = data.subscription;
  if (nested && typeof nested === "object" && "subscription_code" in nested) {
    const code = (nested as { subscription_code?: unknown }).subscription_code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** Re-reads one subscription from Paystack and syncs it onto its creator. */
async function syncByCode(deps: BillingDeps, code: string): Promise<WebhookOutcome> {
  const fetched = await deps.paystack!.fetchSubscription(code);
  if (!fetched.ok) {
    log("error", "billing_provider_failed", { provider: "paystack", stage: "fetch_subscription", code: fetched.code });
    return fetched.transient ? RETRY_LATER : OK;
  }
  if (!planForPaystackCode(deps.config.paystack!, fetched.data.planCode)) return OK; // not ours
  const userId = await findUserForCustomer(deps.db, fetched.data.customerCode);
  if (userId === "error") return RETRY_LATER;
  // Arrived before the first charge was processed: retry later.
  if (!userId) return RETRY_LATER;
  return (await syncPaystackSubscription(deps, userId, fetched.data)) ? OK : RETRY_LATER;
}

/** A charge we didn't start: a monthly renewal Paystack made on its own. */
async function handleRenewal(deps: BillingDeps, reference: string): Promise<WebhookOutcome> {
  const verified = await deps.paystack!.verifyTransaction(reference);
  if (!verified.ok) return verified.transient ? RETRY_LATER : OK;
  const tx = verified.data;
  if (tx.status !== "success") return OK;
  const plan = planForPaystackCode(deps.config.paystack!, tx.planCode);
  if (!plan) return OK; // another product on the same Paystack account

  const userId = await findUserForCustomer(deps.db, tx.customerCode);
  if (userId === "error" || !userId) return RETRY_LATER;

  if (tx.currency === "NGN" && tx.amountMinor > 0) {
    const nowIso = new Date(deps.now()).toISOString();
    const inserted = await deps.db.from("payments").insert({
      user_id: userId,
      provider: "paystack",
      kind: "renewal",
      plan,
      reference: tx.reference,
      provider_order_id: tx.id,
      provider_customer_id: tx.customerCode,
      amount_minor: tx.amountMinor,
      currency: "NGN",
      status: "succeeded",
      applied_at: nowIso,
      last_checked_at: nowIso,
    });
    if (inserted.error && inserted.error.code !== UNIQUE_VIOLATION) {
      log("error", "billing_apply_failed", { provider: "paystack", stage: "renewal", db_code: inserted.error.code });
      return RETRY_LATER;
    }
  }

  const current = await deps.db
    .from("subscriptions")
    .select("provider_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (current.error) return RETRY_LATER;
  if (current.data?.provider_subscription_id) return syncByCode(deps, current.data.provider_subscription_id);

  const listed = await deps.paystack!.listSubscriptions(tx.customerId);
  if (!listed.ok) return listed.transient ? RETRY_LATER : OK;
  const match = listed.data.find((s) => s.planCode === tx.planCode && LIVE_PAYSTACK.has(s.status));
  if (!match) return OK;
  return (await syncPaystackSubscription(deps, userId, match)) ? OK : RETRY_LATER;
}

/** Handles a Paystack event whose signature the route has already verified. */
export async function handlePaystackEvent(deps: BillingDeps, event: PaystackEvent): Promise<WebhookOutcome> {
  if (!deps.paystack || !deps.config.paystack) return OK;
  try {
    if (event.event === "charge.success") {
      const reference = event.data.reference;
      if (typeof reference !== "string" || !reference) return OK;
      const payment = await findPayment(deps.db, "paystack", reference);
      if (payment.error) return RETRY_LATER;
      if (!payment.data) return handleRenewal(deps, reference);
      const result = await confirmPayment(deps, payment.data as PaymentRow);
      return result.ok || !result.transient ? OK : RETRY_LATER;
    }
    if (SUBSCRIPTION_EVENTS.has(event.event) || INVOICE_EVENTS.has(event.event)) {
      const code = subscriptionCodeOf(event);
      return code ? syncByCode(deps, code) : OK;
    }
    return OK;
  } catch (error) {
    log("error", "billing_webhook_failed", {
      provider: "paystack",
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return RETRY_LATER;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation (daily job): catches what lost webhooks missed
// ---------------------------------------------------------------------------

/** Subscriptions this close to (or this far past) their period end are re-read. */
export const RECONCILE_DUE_AHEAD_MS = DAY_MS;
export const RECONCILE_LAPSED_MS = 7 * DAY_MS;
/** Pending checkouts younger than this are still in flight. */
export const RECONCILE_PENDING_MIN_AGE_MS = 10 * 60 * 1000;

export type ReconcileResult = { ok: true; skipped: boolean; subscriptions: number; payments: number } | { ok: false };

/**
 * Re-reads due or recently lapsed Paystack subscriptions (a renewal whose
 * webhooks were lost would otherwise drop a paying creator to Free) and
 * confirms checkouts still pending. Bounded per run by `limit` rows each and a
 * time budget checked before every provider call; what's left waits for the
 * next run. Idempotent, like the webhook paths it reuses. Counts rows checked.
 */
export async function reconcilePaystack(
  deps: BillingDeps,
  { limit = 25, budgetMs = 40_000 }: { limit?: number; budgetMs?: number } = {},
): Promise<ReconcileResult> {
  if (!deps.paystack || !deps.config.paystack) return { ok: true, skipped: true, subscriptions: 0, payments: 0 };
  const started = deps.now();
  const overBudget = () => deps.now() - started >= budgetMs;
  const iso = (ms: number) => new Date(ms).toISOString();

  try {
    const due = await deps.db
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("provider", "paystack")
      .not("provider_subscription_id", "is", null)
      .neq("status", "canceled")
      .gte("current_period_end", iso(started - RECONCILE_LAPSED_MS))
      .lte("current_period_end", iso(started + RECONCILE_DUE_AHEAD_MS))
      .order("current_period_end", { ascending: true })
      .limit(limit);
    if (due.error) {
      log("error", "billing_reconcile_failed", { provider: "paystack", stage: "subscriptions", db_code: due.error.code });
      return { ok: false };
    }

    let subscriptions = 0;
    for (const row of due.data ?? []) {
      if (overBudget()) return { ok: true, skipped: false, subscriptions, payments: 0 };
      await syncByCode(deps, row.provider_subscription_id!);
      subscriptions += 1;
    }

    const pending = await deps.db
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("provider", "paystack")
      .eq("status", "pending")
      .gte("created_at", iso(started - PENDING_EXPIRY_MS))
      .lte("created_at", iso(started - RECONCILE_PENDING_MIN_AGE_MS))
      .order("created_at", { ascending: true })
      .limit(limit);
    if (pending.error) {
      log("error", "billing_reconcile_failed", { provider: "paystack", stage: "payments", db_code: pending.error.code });
      return { ok: false };
    }

    let payments = 0;
    for (const row of (pending.data ?? []) as PaymentRow[]) {
      if (overBudget()) break;
      await confirmPayment(deps, row);
      payments += 1;
    }
    return { ok: true, skipped: false, subscriptions, payments };
  } catch (error) {
    log("error", "billing_reconcile_failed", {
      provider: "paystack",
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Creator actions: return page, Check status, cancel, manage card
// ---------------------------------------------------------------------------

export type CreatorConfirmResult = { ok: true; status: PaymentStatus } | Fail;

/** The return page: confirms a payment only if it belongs to the signed-in creator. */
export async function confirmReturn(
  deps: BillingDeps,
  userId: string,
  provider: BillingProvider,
  reference: string,
): Promise<CreatorConfirmResult> {
  try {
    const payment = await findPayment(deps.db, provider, reference);
    if (payment.error) return fail("persistence_error");
    if (!payment.data || payment.data.user_id !== userId) return fail("not_found");
    const result = await confirmPayment(deps, payment.data as PaymentRow);
    // A provider hiccup leaves it pending; "Check status" can retry.
    return result.ok ? result : { ok: true, status: "pending" };
  } catch (error) {
    log("error", "billing_confirm_failed", { provider, stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
    return fail("persistence_error");
  }
}

/** "Check status" on a pending payment, at most once per 30 seconds. */
export async function checkPayment(deps: BillingDeps, userId: string, paymentId: string): Promise<CreatorConfirmResult> {
  try {
    const payment = await deps.db
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("id", paymentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (payment.error) return fail("persistence_error");
    if (!payment.data) return fail("not_found");
    const row = payment.data as PaymentRow;
    if (row.status !== "pending") return { ok: true, status: row.status as PaymentStatus };
    if (row.last_checked_at && deps.now() - Date.parse(row.last_checked_at) < CHECK_COOLDOWN_MS) return fail("too_soon");
    const result = await confirmPayment(deps, row);
    return result.ok ? result : fail("provider_error");
  } catch (error) {
    log("error", "billing_confirm_failed", { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
    return fail("persistence_error");
  }
}

async function currentPaystackRow(deps: BillingDeps, userId: string) {
  const { data, error } = await deps.db.from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
  if (error) return "error" as const;
  const row = data as SubscriptionRow | null;
  if (!row || row.provider !== "paystack" || !row.provider_subscription_id) return null;
  return row;
}

/** Stops a Paystack subscription renewing. Access runs to the end of the paid period. */
export async function cancelPaystackSubscription(deps: BillingDeps, userId: string): Promise<{ ok: true } | Fail> {
  if (!deps.paystack || !deps.config.paystack) return fail("not_configured");
  try {
    const row = await currentPaystackRow(deps, userId);
    if (row === "error") return fail("persistence_error");
    if (!row || !row.provider_email_token) return fail("nothing_to_manage");

    const disabled = await deps.paystack.disableSubscription(row.provider_subscription_id!, row.provider_email_token);
    if (!disabled.ok) {
      log("error", "billing_provider_failed", { provider: "paystack", stage: "disable", code: disabled.code });
      return fail("cancel_failed");
    }
    const fetched = await deps.paystack.fetchSubscription(row.provider_subscription_id!);
    if (fetched.ok) {
      await syncPaystackSubscription(deps, userId, fetched.data);
    } else {
      // Paystack accepted the cancel; record it even if the re-read failed.
      await deps.db.from("subscriptions").update({ cancel_at_period_end: true }).eq("user_id", userId);
    }
    return { ok: true };
  } catch (error) {
    log("error", "billing_cancel_failed", { provider: "paystack", name: error instanceof Error ? error.name : typeof error });
    return fail("cancel_failed");
  }
}

/** Paystack's hosted page where the creator updates their card. */
export async function paystackManageLink(deps: BillingDeps, userId: string): Promise<{ ok: true; url: string } | Fail> {
  if (!deps.paystack || !deps.config.paystack) return fail("not_configured");
  try {
    const row = await currentPaystackRow(deps, userId);
    if (row === "error") return fail("persistence_error");
    if (!row) return fail("nothing_to_manage");
    const link = await deps.paystack.manageLink(row.provider_subscription_id!);
    if (!link.ok) {
      log("error", "billing_provider_failed", { provider: "paystack", stage: "manage_link", code: link.code });
      return fail("provider_error");
    }
    return { ok: true, url: link.data.link };
  } catch (error) {
    log("error", "billing_manage_failed", { provider: "paystack", name: error instanceof Error ? error.name : typeof error });
    return fail("provider_error");
  }
}
