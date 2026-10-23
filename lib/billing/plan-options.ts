import type { BillingProvider, PaidPlan } from "@/lib/schemas/enums";
import { checkoutDecision, type CheckoutBlock, type Entitlement } from "./entitlement";

export interface CheckoutOption {
  provider: BillingProvider;
  label: string;
  /** "Paystack · renews monthly" */
  hint: string;
  /** Null when the button can be used; otherwise why not (shown under it). */
  blocked: string | null;
}

const BLOCKED: Record<CheckoutBlock, string> = {
  already_on_plan: "Available again when your current period ends",
};

/** The pay button for a paid plan, using the same rules the server enforces at checkout. */
export function checkoutOptions(entitlement: Entitlement, plan: PaidPlan, available: boolean): CheckoutOption[] {
  const decision = checkoutDecision(entitlement);
  return [
    {
      provider: "paystack",
      label: "Upgrade with card",
      hint: "Paystack · renews monthly",
      blocked: !available ? "Not available yet" : decision.allowed ? null : BLOCKED[decision.code],
    },
  ];
}
