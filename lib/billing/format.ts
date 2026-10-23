import type { BillingProvider, PaymentKind } from "@/lib/schemas/enums";
import type { PaymentDisplayStatus } from "@/lib/services/billing";

/** "21 Nov 2026" in the creator's zone (UTC without one). */
export function formatBillingDate(instant: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone ?? "UTC",
    }).format(new Date(instant));
  } catch {
    return instant.slice(0, 10);
  }
}

export const PROVIDER_LABELS: Record<BillingProvider, string> = { paystack: "Paystack" };

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  subscription_start: "Monthly subscription",
  renewal: "Monthly renewal",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentDisplayStatus, string> = {
  succeeded: "Paid",
  pending: "Pending",
  failed: "Failed",
  expired: "Expired",
};
