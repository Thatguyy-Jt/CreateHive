import { auth, currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { AiUsageLine, AiUsageLineFallback } from "@/components/dashboard/ai-usage-line";
import { LearnedCard } from "@/components/dashboard/learned-card";
import { PerformanceCard } from "@/components/dashboard/performance-card";
import { DashboardToday } from "@/components/dashboard/today-card";
import { SectionSkeleton } from "@/components/settings/section-skeleton";
import { DashboardStrategyCard } from "@/components/strategy/dashboard-strategy-card";

export const metadata: Metadata = { title: "Dashboard" };

async function Greeting() {
  await auth.protect();
  const user = await currentUser();
  const name = user?.firstName ?? user?.primaryEmailAddress?.emailAddress;

  return <>{name ? `Welcome back, ${name}.` : "Welcome back."}</>;
}

function CardSkeleton({ lines, variant }: { lines: number; variant?: "hero" }) {
  return (
    <div className={`card ${variant === "hero" ? "card-hero min-h-56" : ""}`}>
      <SectionSkeleton lines={lines} />
    </div>
  );
}

// The heading is static; each session-bound section sits behind its own
// Suspense, calls `auth.protect()` itself and fails independently.
// Today is the hero and always comes first (AGENTS.md §14).
export default function DashboardPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="dashboard"
        title="Dashboard"
        description={
          <Suspense fallback={<span aria-hidden="true">&nbsp;</span>}>
            <Greeting />
          </Suspense>
        }
      />
      <div className="grid gap-6">
        <Suspense fallback={<CardSkeleton lines={4} variant="hero" />}>
          <DashboardToday />
        </Suspense>
      </div>
      <Suspense fallback={<CardSkeleton lines={3} />}>
        <DashboardStrategyCard />
      </Suspense>
      <div className="grid gap-6 md:grid-cols-2">
        <Suspense fallback={<CardSkeleton lines={3} />}>
          <PerformanceCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton lines={3} />}>
          <LearnedCard />
        </Suspense>
      </div>
      <Suspense fallback={<AiUsageLineFallback />}>
        <AiUsageLine />
      </Suspense>
    </div>
  );
}
