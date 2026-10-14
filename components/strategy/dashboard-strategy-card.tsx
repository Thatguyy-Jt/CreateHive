import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { todayIn, weekStart } from "@/lib/calendar/dates";
import { elapsedPlanWeek, PLAN_WEEKS } from "@/lib/calendar/plan-week";
import { getTimezone } from "@/lib/services/calendar";
import { getOnboardingState } from "@/lib/services/creator-profile";
import { getCreatorStrategy } from "@/lib/services/creator-strategy";
import { createUserClient } from "@/lib/supabase/server";
import { FinishSetupCard } from "./finish-setup-card";

/** Dashboard entry point: finish setup, build the strategy, or this week's focus. */
export async function DashboardStrategyCard() {
  // The plan week depends on the current time, so this must never be prerendered.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch {
    // Logged by the services on real failures; the dashboard stays usable.
    return <Unavailable />;
  }

  const [onboarding, stored, timezone] = await Promise.all([
    getOnboardingState(client, userId),
    getCreatorStrategy(client, userId),
    getTimezone(client, userId),
  ]);
  if (!onboarding.ok || !stored.ok) return <Unavailable />;

  const { strategy } = stored;
  if (!strategy) {
    if (onboarding.data.status !== "completed") return <FinishSetupCard headingId="dashboard-setup" />;
    return (
      <section className="card stack-sm" aria-labelledby="dashboard-strategy">
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

  // Counted in the creator's zone, or UTC until they confirm one (as the weekly planner does).
  const tz = (timezone.ok ? timezone.timezone : null) ?? "UTC";
  const today = todayIn(tz);
  const thisWeek = today ? weekStart(today) : null;
  const elapsed = thisWeek ? elapsedPlanWeek(strategy.updated_at, thisWeek, tz) : null;
  const week = elapsed !== null && elapsed <= PLAN_WEEKS ? strategy.thirty_day_plan[elapsed - 1] : null;

  return (
    <section className="card stack-sm" aria-labelledby="dashboard-strategy">
      <p className="eyebrow">Your positioning</p>
      <h2 id="dashboard-strategy" className="text-heading">
        {strategy.positioning}
      </h2>
      {week ? (
        <p>
          <span className="font-semibold">Week {elapsed} focus:</span> {week.theme}. {week.focus}
        </p>
      ) : elapsed !== null && elapsed > PLAN_WEEKS ? (
        <p>Your 30-day plan has finished. Rebuild your strategy for a fresh plan.</p>
      ) : null}
      <div>
        <Link href="/app/strategy" className="link-arrow">
          {elapsed !== null && elapsed > PLAN_WEEKS ? "Rebuild your strategy" : "See your full strategy"}
        </Link>
      </div>
    </section>
  );
}

function Unavailable() {
  return (
    <section className="card stack-sm" aria-labelledby="dashboard-strategy">
      <h2 id="dashboard-strategy" className="text-heading">
        Your strategy
      </h2>
      <p className="text-muted-foreground">We couldn&apos;t load this right now. Refresh the page to try again.</p>
    </section>
  );
}
