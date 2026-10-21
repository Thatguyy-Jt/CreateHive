import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { formatDay, localDateKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { getTimezone } from "@/lib/services/calendar";
import { getInsightsOverview, type InsightsOverview } from "@/lib/services/insights";
import { createUserClient } from "@/lib/supabase/server";
import { EmptyHero } from "../app-shell/empty-hero";
import { InsightCard } from "./insight-card";
import { UpdateControl } from "./update-control";

function LoadError() {
  return (
    <div role="alert" className="card stack-sm">
      <h2 className="text-heading">Something went wrong</h2>
      <p className="text-muted-foreground">We couldn&apos;t load your insights right now. Refresh the page to try again.</p>
    </div>
  );
}

/** "Oct 14" in the creator's zone, or the UTC date without one. */
function dayLabel(instant: string, tz: string | null): string {
  const key = (tz ? localDateKey(instant, tz) : null) ?? instant.slice(0, 10);
  return formatDay(key) ?? key;
}

function NotReady({ overview }: { overview: InsightsOverview }) {
  return (
    <EmptyHero
      title="Not enough results yet"
      titleId="insights-ready"
      action={
        <Link href="/app/analytics" className="btn btn-secondary btn-sm">
          Go to Analytics
        </Link>
      }
    >
      <p className="font-semibold text-foreground">
        {Math.min(overview.settled, overview.needed)} of {overview.needed} posts with week-old results.
      </p>
      <p className="mt-2">
        Patterns need several posts to compare. Log your posts and add results from a week or more after posting.
      </p>
    </EmptyHero>
  );
}

/** The update panel and the active insights. Opening the page never calls AI. */
export async function InsightsContent() {
  // "Updates left today" depends on the current time.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "insights_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const [result, timezone] = await Promise.all([getInsightsOverview(client, userId), getTimezone(client, userId)]);
  if (!result.ok) return <LoadError />;
  const { overview } = result;
  const tz = timezone.ok ? timezone.timezone : null;

  if (overview.settled < overview.needed && overview.insights.length === 0) return <NotReady overview={overview} />;

  const ready = overview.settled >= overview.needed;
  const left = Math.max(0, overview.updatesLimit - overview.updatesUsed);
  const livePostIds = new Set(overview.livePostIds);
  return (
    <div className="stack-lg">
      <section className="card stack-sm" aria-labelledby="insights-update">
        <h2 id="insights-update" className="text-heading">
          {overview.lastUpdatedAt ? "Your insights" : "Ready to look for patterns"}
        </h2>
        <p className="text-muted-foreground">
          {overview.lastUpdatedAt
            ? `Updated ${dayLabel(overview.lastUpdatedAt, tz)} · ${overview.settled} posts with week-old results.`
            : `You have ${overview.settled} posts with week-old results. AI can look across them for what tends to work for you.`}
        </p>
        {overview.lastUpdatedAt ? (
          <p className="field-help">
            {overview.newResults
              ? "You've added results since your last update."
              : "No new results since your last update."}
          </p>
        ) : null}
        {ready ? (
          <UpdateControl again={overview.lastUpdatedAt !== null && !overview.newResults} left={left} />
        ) : (
          <p className="field-help">
            Updating needs {overview.needed} posts with week-old results; you have {overview.settled}.
          </p>
        )}
      </section>

      {overview.lastUpdatedAt || overview.insights.length ? (
        <section className="stack-md" aria-labelledby="insights-list-heading">
          <h2 id="insights-list-heading" tabIndex={-1} className="text-heading outline-none">
            What we&apos;ve noticed
          </h2>
          {overview.insights.length ? (
            <ul className="stack-md">
              {overview.insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} livePostIds={livePostIds} />
              ))}
            </ul>
          ) : (
            <p className="card text-muted-foreground">
              No clear patterns yet. Keep posting and add results; patterns need at least two posts that agree.
            </p>
          )}
        </section>
      ) : (
        <h2 id="insights-list-heading" tabIndex={-1} className="sr-only">
          What we&apos;ve noticed
        </h2>
      )}
    </div>
  );
}
