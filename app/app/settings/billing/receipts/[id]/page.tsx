import type { Metadata } from "next";
import { Suspense } from "react";
import { ReceiptContent } from "@/components/billing/receipt-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Payment receipt" };

// `params`, `searchParams` and the session are read behind Suspense, where the
// content calls `auth.protect()` itself.
export default function ReceiptPage({ params, searchParams }: PageProps<"/app/settings/billing/receipts/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="card max-w-2xl" aria-hidden="true">
          <SectionSkeleton lines={6} />
        </div>
      }
    >
      <ReceiptContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
