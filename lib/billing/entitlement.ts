import {
  billingProvider,
  subscriptionPlan,
  type BillingProvider,
  type PaidPlan,
  type SubscriptionStatus,
} from "@/lib/schemas/enums";

/** The `subscriptions` columns the entitlement needs. Never includes provider tokens. */
export interface SubscriptionState {
  plan: string;
  status: string;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export const SUBSCRIPTION_STATE_COLUMNS = "plan, status, provider, current_period_end, cancel_at_period_end";

export type Entitlement =
  | { plan: "free"; paid: false; provider: null; status: null; endsAt: null; renews: false }
  | {
      plan: PaidPlan;
      paid: true;
      provider: BillingProvider;
      status: SubscriptionStatus;
      /** When access ends (cancelled) or next renews (active). */
      endsAt: string | null;
      /** True only for an active subscription that will charge again. */
      renews: boolean;
    };

export const FREE: Entitlement = { plan: "free", paid: false, provider: null, status: null, endsAt: null, renews: false };

const ACCESS_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

/**
 * What the creator is entitled to right now. Computed at read time from the
 * row, so a cancelled or lapsed subscription needs no job to end it:
 * a paid plan counts while its status grants access and its period hasn't ended.
 */
export function resolveEntitlement(row: SubscriptionState | null, now: number): Entitlement {
  if (!row) return FREE;
  const plan = subscriptionPlan.safeParse(row.plan);
  const provider = billingProvider.safeParse(row.provider);
  if (!plan.success || plan.data === "free" || !provider.success) return FREE;
  if (!ACCESS_STATUSES.has(row.status)) return FREE;

  const end = row.current_period_end ? Date.parse(row.current_period_end) : null;
  if (end !== null && (Number.isNaN(end) || end <= now)) return FREE;

  return {
    plan: plan.data,
    paid: true,
    provider: provider.data,
    status: row.status as SubscriptionStatus,
    endsAt: row.current_period_end,
    renews: row.status !== "past_due" && !row.cancel_at_period_end,
  };
}

export const EXPIRY_WARNING_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A cancelled plan that ends within the warning window. */
export function endsSoon(entitlement: Entitlement, now: number): boolean {
  if (!entitlement.paid || entitlement.renews || !entitlement.endsAt) return false;
  const end = Date.parse(entitlement.endsAt);
  return end > now && end - now <= EXPIRY_WARNING_DAYS * DAY_MS;
}

// ---------------------------------------------------------------------------
// Checkout rules: shared by the billing page (to label buttons) and the
// service (to enforce them), so the two can't disagree.
// ---------------------------------------------------------------------------

export type CheckoutBlock = "already_on_plan";

export type CheckoutDecision = { allowed: true } | { allowed: false; code: CheckoutBlock };

export function checkoutDecision(entitlement: Entitlement): CheckoutDecision {
  // A subscription already renews (or, once cancelled, can be taken again after it ends).
  return entitlement.paid ? { allowed: false, code: "already_on_plan" } : { allowed: true };
}
