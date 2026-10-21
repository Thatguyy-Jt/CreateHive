import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { SectionSkeleton } from "@/components/settings/section-skeleton";
import { StrategyContent } from "@/components/strategy/strategy-content";
import { StrategyNoticeToast } from "@/components/strategy/strategy-notice-toast";

export const metadata: Metadata = { title: "Strategy" };

// The heading is static; the session-bound strategy sits behind Suspense and
// calls `auth.protect()` itself.
export default function StrategyPage({ searchParams }: PageProps<"/app/strategy">) {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="strategy"
        title="Your strategy"
        description="Who you’re for, what you’ll make, and what to do this month."
      />
      <Suspense
        fallback={
          <div className="card max-w-3xl">
            <SectionSkeleton lines={4} />
          </div>
        }
      >
        <StrategyContent searchParams={searchParams} />
      </Suspense>
      {/* Reads the URL, so Cache Components needs it behind Suspense. */}
      <Suspense>
        <StrategyNoticeToast />
      </Suspense>
    </div>
  );
}
