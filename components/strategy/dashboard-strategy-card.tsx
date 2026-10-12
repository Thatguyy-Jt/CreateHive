import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { getOnboardingState } from "@/lib/services/creator-profile";
import { getCreatorStrategy } from "@/lib/services/creator-strategy";
import { createUserClient } from "@/lib/supabase/server";
import { FinishSetupCard } from "./finish-setup-card";

/** Dashboard entry point: finish setup, build the strategy, or this week's focus. */
export async function DashboardStrategyCard() {
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch {
    // Logged by the services on real failures; the dashboard stays usable.
    return <Unavailable />;
  }

  const [onboarding, stored] = await Promise.all([getOnboardingState(client, userId), getCreatorStrategy(client, userId)]);
  if (!onboarding.ok || !stored.ok) return <Unavailable />;

  const { strategy } = stored;
  if (!strategy) {
    if (onboarding.data.status !== "completed") return <FinishSetupCard headingId="dashboard-setup" />;
    return (
      <section className="card max-w-2xl stack-sm" aria-labelledby="dashboard-strategy">
        <h2 id="dashboard-strategy" className="text-heading">
          Your strategy isn&apos;t built yet
        </h2>
        <p className="text-muted-foreground">Your profile is saved. Build your strategy to get your first 30-day plan.</p>
        <div>
          <Link href="/app/strategy" className="btn btn-primary w-full sm:w-auto">
            Build my strategy
          </Link>
        </div>
      </section>
    );
  }

  const week = strategy.thirty_day_plan[0];
  return (
    <section className="card max-w-2xl stack-sm" aria-labelledby="dashboard-strategy">
      <p className="eyebrow">Your positioning</p>
      <h2 id="dashboard-strategy" className="text-heading">
        {strategy.positioning}
      </h2>
      <p>
        <span className="font-semibold">Week 1 focus:</span> {week.theme}. {week.focus}
      </p>
      <div>
        <Link href="/app/strategy" className="link-arrow">
          See your full strategy
        </Link>
      </div>
    </section>
  );
}

function Unavailable() {
  return (
    <section className="card max-w-2xl stack-sm" aria-labelledby="dashboard-strategy">
      <h2 id="dashboard-strategy" className="text-heading">
        Your strategy
      </h2>
      <p className="text-muted-foreground">We couldn&apos;t load this right now. Refresh the page to try again.</p>
    </section>
  );
}
