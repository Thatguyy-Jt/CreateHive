import { auth, currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
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

  return <p className="lead">{name ? `Signed in as ${name}.` : "You're signed in."}</p>;
}

function CardSkeleton({ lines, offset = false }: { lines: number; offset?: boolean }) {
  return (
    <div className={`card ${offset ? "card-offset" : ""}`}>
      <SectionSkeleton lines={lines} />
    </div>
  );
}

// The heading is static; each session-bound section sits behind its own
// Suspense, calls `auth.protect()` itself and fails independently.
export default function DashboardPage() {
  return (
    <div className="stack-lg max-w-3xl">
      <div className="stack-sm">
        <h1>Dashboard</h1>
        <Suspense fallback={<p className="lead" aria-hidden="true">&nbsp;</p>}>
          <Greeting />
        </Suspense>
      </div>
      <Suspense fallback={<CardSkeleton lines={4} offset />}>
        <DashboardToday />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={3} />}>
        <DashboardStrategyCard />
      </Suspense>
      <Suspense fallback={<AiUsageLineFallback />}>
        <AiUsageLine />
      </Suspense>
      <div className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<CardSkeleton lines={3} />}>
          <PerformanceCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton lines={3} />}>
          <LearnedCard />
        </Suspense>
      </div>
    </div>
  );
}
