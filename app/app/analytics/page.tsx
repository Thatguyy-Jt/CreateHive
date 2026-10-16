import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsContent } from "@/components/analytics/analytics-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Analytics" };

function AnalyticsSkeleton() {
  return (
    <div className="stack-lg" aria-hidden="true">
      {[3, 2, 3].map((lines, index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={lines} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; the session-bound content sits behind Suspense and
// calls `auth.protect()` itself.
export default function AnalyticsPage() {
  return (
    <div className="stack-lg max-w-3xl">
      <div className="stack-sm">
        <h1>Analytics</h1>
        <p className="lead">Log what you posted and see how each post compares with your own usual numbers.</p>
        <p className="field-help">
          We don&apos;t connect to your accounts yet: you enter the numbers from each platform&apos;s insights.
        </p>
      </div>
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsContent />
      </Suspense>
    </div>
  );
}
