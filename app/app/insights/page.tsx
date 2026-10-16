import type { Metadata } from "next";
import { Suspense } from "react";
import { InsightsContent } from "@/components/insights/insights-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Insights" };

function InsightsSkeleton() {
  return (
    <div className="stack-lg" aria-hidden="true">
      {[2, 3, 3].map((lines, index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={lines} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; the session-bound content sits behind Suspense and
// calls `auth.protect()` itself.
export default function InsightsPage() {
  return (
    <div className="stack-lg max-w-3xl">
      <div className="stack-sm">
        <h1>Insights</h1>
        <p className="lead">Patterns from your own results: what seems to work for you, and what to try next.</p>
        <p className="field-help">
          Based only on the numbers you&apos;ve entered. Insights get more reliable as you add results.
        </p>
      </div>
      <Suspense fallback={<InsightsSkeleton />}>
        <InsightsContent />
      </Suspense>
    </div>
  );
}
