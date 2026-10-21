import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { CardHeader } from "@/components/app-shell/card-header";
import { logEvent } from "@/lib/observability/log";
import { CONFIDENCE_LABELS } from "@/lib/schemas/insights";
import { getInsightsOverview } from "@/lib/services/insights";
import { createUserClient } from "@/lib/supabase/server";

/** Insights shown on the dashboard. */
const TOP_INSIGHTS = 2;

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="card stack-sm" aria-labelledby="dashboard-learned">
      <CardHeader icon="sparkle">
        <h2 id="dashboard-learned" className="text-heading">
          What AI learned
        </h2>
      </CardHeader>
      {children}
    </section>
  );
}

const action = (href: string, label: string) => (
  <div className="mt-auto">
    <Link href={href} className="btn btn-secondary btn-sm w-full min-[480px]:w-auto">
      {label}
    </Link>
  </div>
);

/** The creator's strongest learned patterns, or the next step to get some. Real data only; never calls AI. */
export async function LearnedCard() {
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "insights_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return (
      <Card>
        <p className="text-muted-foreground">We couldn&apos;t load your insights right now.</p>
      </Card>
    );
  }

  const result = await getInsightsOverview(client, userId);
  if (!result.ok) {
    return (
      <Card>
        <p className="text-muted-foreground">We couldn&apos;t load your insights right now. Refresh to try again.</p>
        {action("/app/insights", "Open Insights")}
      </Card>
    );
  }
  const { overview } = result;
  const top = overview.insights.slice(0, TOP_INSIGHTS);

  if (top.length) {
    return (
      <Card>
        <ul className="stack-sm">
          {top.map((insight) => (
            <li key={insight.id} className="grid gap-1 border-b border-border pb-3 last:border-0">
              <p className="font-semibold break-words">{insight.summary}</p>
              <p className="text-sm text-muted-foreground">
                {insight.confidence ? CONFIDENCE_LABELS[insight.confidence] : null}
                {insight.confidence && insight.sample_size ? " · " : null}
                {insight.sample_size ? `${insight.sample_size} posts` : null}
              </p>
            </li>
          ))}
        </ul>
        {action("/app/insights", "See all insights")}
      </Card>
    );
  }
  if (overview.settled < overview.needed) {
    const done = Math.min(overview.settled, overview.needed);
    return (
      <Card>
        <div className="grid gap-2">
          <p id="dashboard-learned-progress" className="font-bold">
            {done} of {overview.needed} posts with week-old results
          </p>
          <div
            role="meter"
            aria-labelledby="dashboard-learned-progress"
            aria-valuemin={0}
            aria-valuemax={overview.needed}
            aria-valuenow={done}
            className="meter"
          >
            <div className="meter-fill" style={{ width: `${(done / overview.needed) * 100}%` }} />
          </div>
        </div>
        <p className="text-muted-foreground">Patterns appear once {overview.needed} posts have week-old results.</p>
        {action("/app/analytics", "Add results")}
      </Card>
    );
  }
  return (
    <Card>
      <p className="text-muted-foreground">
        {overview.lastUpdatedAt
          ? "No clear patterns yet. Add more results, then update your insights."
          : "Ready to look for patterns in your results."}
      </p>
      {action("/app/insights", "Open Insights")}
    </Card>
  );
}
