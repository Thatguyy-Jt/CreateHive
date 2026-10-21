import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
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
export default function AnalyticsPage({ searchParams }: PageProps<"/app/analytics">) {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="analytics"
        title="Analytics"
        description="Log what you posted and see how each post compares with your own usual numbers."
        note="We don’t connect to your accounts yet: you enter the numbers from each platform’s insights."
      />
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
