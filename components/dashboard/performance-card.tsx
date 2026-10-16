import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { formatCount } from "@/lib/analytics/format";
import { logEvent } from "@/lib/observability/log";
import { getPerformanceSummary } from "@/lib/services/analytics";
import { createUserClient } from "@/lib/supabase/server";
import { ComparisonPill } from "../analytics/comparison";
import { Sparkline } from "../charts/sparkline";

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="card stack-sm" aria-labelledby="dashboard-performance">
      <h2 id="dashboard-performance" className="text-heading">
        Performance
      </h2>
      {children}
    </section>
  );
}

const action = (href: string, label: string, ariaLabel?: string) => (
  <div className="mt-auto">
    <Link href={href} className="btn btn-secondary btn-sm w-full min-[480px]:w-auto" aria-label={ariaLabel}>
      {label}
    </Link>
  </div>
);

/** The latest settled post against the creator's usual, or the next step to get there. Real data only. */
export async function PerformanceCard() {
  // "Needs results" depends on the current time.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "analytics_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return (
      <Card>
        <p className="text-muted-foreground">We couldn&apos;t load your results right now.</p>
      </Card>
    );
  }

  const result = await getPerformanceSummary(client, userId);
  if (!result.ok) {
    return (
      <Card>
        <p className="text-muted-foreground">We couldn&apos;t load your results right now. Refresh to try again.</p>
        {action("/app/analytics", "Open analytics")}
      </Card>
    );
  }
  const { summary } = result;

  if (summary.totalPosts === 0) {
    return (
      <Card>
        <p className="text-muted-foreground">
          No posts logged yet. Log a post you already made to start comparing against your own usual numbers.
        </p>
        {action("/app/analytics", "Log a past post")}
      </Card>
    );
  }

  const latest = summary.latestSettled;
  const views = latest?.comparison.metrics.find((m) => m.metric === "views");
  const spark = summary.spark && summary.spark.points.length >= 2 ? summary.spark : null;
  return (
    <Card>
      {latest ? (
        <div className="grid gap-1">
          <p className="field-help">Latest post with settled results</p>
          <p className="font-semibold break-words">
            <Link href={`/app/analytics/${latest.id}`} className="link">
              {latest.title}
            </Link>
          </p>
          {views?.value !== null && views?.value !== undefined ? (
            <p className="text-3xl font-semibold leading-tight">
              {formatCount(views.value, true)} <span className="text-base font-normal text-muted-foreground">views</span>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {latest.comparison.headline ? <ComparisonPill label={latest.comparison.headline.label} /> : null}
            {views?.value !== null && views?.value !== undefined ? (
              <span className="text-sm text-muted-foreground">
                {views.median !== null ? `vs your usual ${formatCount(views.median, true)}` : "Not enough posts to compare yet"}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">No settled results yet: results count once a post is a week old.</p>
      )}
      {spark ? (
        <div>
          <Sparkline points={spark.points} usual={spark.usualViews} />
          <p className="sr-only">
            Views of your last {spark.points.length} posts, from{" "}
            {formatCount(Math.min(...spark.points.map((p) => p.views)))} to{" "}
            {formatCount(Math.max(...spark.points.map((p) => p.views)))}
            {spark.usualViews !== null ? `; your usual is ${formatCount(spark.usualViews)}` : ""}.
          </p>
          <p className="field-help" aria-hidden="true">
            Your last {spark.points.length} posts{spark.usualViews !== null ? " · line shows your usual" : ""}
          </p>
        </div>
      ) : null}
      {summary.needsResultsCount > 0 && summary.firstNeedsResults ? (
        <>
          <p>
            {summary.needsResultsCount} {summary.needsResultsCount === 1 ? "post needs" : "posts need"} results.
          </p>
          {action(
            `/app/analytics/${summary.firstNeedsResults.id}#results`,
            "Add results",
            `Add results for ${summary.firstNeedsResults.title}`,
          )}
        </>
      ) : (
        action("/app/analytics", "Open analytics")
      )}
    </Card>
  );
}
