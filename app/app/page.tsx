import { auth, currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SectionSkeleton } from "@/components/settings/section-skeleton";
import { DashboardStrategyCard } from "@/components/strategy/dashboard-strategy-card";

export const metadata: Metadata = { title: "Dashboard" };

async function Greeting() {
  await auth.protect();
  const user = await currentUser();
  const name = user?.firstName ?? user?.primaryEmailAddress?.emailAddress;

  return <p className="lead">{name ? `Signed in as ${name}.` : "You're signed in."}</p>;
}

export default function DashboardPage() {
  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <h1>Dashboard</h1>
        <Suspense fallback={<p className="lead" aria-hidden="true">&nbsp;</p>}>
          <Greeting />
        </Suspense>
      </div>
      <Suspense
        fallback={
          <div className="card max-w-2xl">
            <SectionSkeleton lines={3} />
          </div>
        }
      >
        <DashboardStrategyCard />
      </Suspense>
    </div>
  );
}
