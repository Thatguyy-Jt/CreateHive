import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingContent } from "@/components/billing/billing-content";
import { CheckoutNoticeToast } from "@/components/billing/checkout-notice-toast";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Billing" };

function BillingSkeleton() {
  return (
    <div className="stack-lg" aria-hidden="true">
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="card">
            <SectionSkeleton lines={5} />
          </div>
        ))}
      </div>
      <div className="card">
        <SectionSkeleton lines={4} />
      </div>
    </div>
  );
}

// The heading is static; the session-bound content sits behind Suspense and
// calls `auth.protect()` itself.
export default function BillingPage() {
  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <h2 className="text-heading">Billing &amp; subscription</h2>
        <p className="text-muted-foreground">Manage your plan, payment details and receipts. Prices are in naira.</p>
      </div>
      <Suspense fallback={null}>
        <CheckoutNoticeToast />
      </Suspense>
      <Suspense fallback={<BillingSkeleton />}>
        <BillingContent />
      </Suspense>
    </div>
  );
}
