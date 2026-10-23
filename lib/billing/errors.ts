// Creator-facing copy for every billing failure. Codes are stable and safe to
// log; messages never include provider text, references or amounts we didn't set.

export type BillingErrorCode =
  | "not_configured"
  | "already_on_plan"
  | "too_many_attempts"
  | "price_mismatch"
  | "missing_email"
  | "provider_error"
  | "persistence_error"
  | "not_found"
  | "too_soon"
  | "cancel_failed"
  | "nothing_to_manage";

export const BILLING_ERRORS: Record<BillingErrorCode, string> = {
  not_configured: "This payment option isn't available yet.",
  already_on_plan: "You're already on this plan. You can subscribe again once your current period ends.",
  too_many_attempts: "Too many checkout attempts in the last hour. Try again a little later.",
  price_mismatch: "This plan's price is being updated. Nothing was charged. Try again later.",
  missing_email: "Add an email address to your account (Settings → Manage account) to pay by card.",
  provider_error: "We couldn't open the payment page. Nothing was charged. Try again in a minute.",
  persistence_error: "Something went wrong on our side. Nothing was charged. Try again in a minute.",
  not_found: "We couldn't find that payment.",
  too_soon: "We just checked this payment. Try again in a few seconds.",
  cancel_failed: "We couldn't reach the payment provider. Your plan hasn't changed. Try again in a minute.",
  nothing_to_manage: "There's no card subscription to manage.",
};
