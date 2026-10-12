import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { isAiEnabled, readDailyGenerationLimit } from "@/lib/ai/env";
import { logEvent } from "@/lib/observability/log";
import { getAiUsage } from "@/lib/services/ai-usage";
import { createUserClient } from "@/lib/supabase/server";
import { SectionSkeleton } from "./section-skeleton";

const READ_FAILED = "We couldn't load your usage right now. Refresh to try again.";

// Full class strings (not interpolated) so Tailwind can see them.
const BAR_BASE =
  "h-2.5 w-full appearance-none overflow-hidden rounded-pill border border-border bg-surface-muted [&::-webkit-progress-bar]:bg-surface-muted";
const BAR_NORMAL = `${BAR_BASE} [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary`;
const BAR_AT_CAP = `${BAR_BASE} [&::-webkit-progress-value]:bg-danger [&::-moz-progress-bar]:bg-danger`;

async function AiUsageDetails() {
  // The count depends on the current time, so it must never be prerendered.
  // Clerk's session read alone doesn't tell Next that; `connection()` does.
  await connection();
  // Identity from Clerk's server session only.
  const { userId } = await auth.protect();

  if (!isAiEnabled()) return <p>AI features are paused right now.</p>;

  const limit = readDailyGenerationLimit();
  if (limit === null) {
    logEvent("error", "ai_usage_read_failed", { stage: "config", variables: ["AI_DAILY_GENERATION_LIMIT"] });
    return <p>{READ_FAILED}</p>;
  }

  let client;
  try {
    // Acts as the creator: RLS limits the count to their own rows.
    client = createUserClient();
  } catch (error) {
    logEvent("error", "ai_usage_read_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    return <p>{READ_FAILED}</p>;
  }

  const usage = await getAiUsage(client, userId, limit);
  if (!usage.ok) return <p>{READ_FAILED}</p>;

  const atCap = usage.used >= usage.limit;

  return (
    <div className="stack-sm">
      <p id="ai-usage-count">
        <strong>{usage.used}</strong> of <strong>{usage.limit}</strong> AI generations used in the last 24 hours
      </p>
      <progress
        className={atCap ? BAR_AT_CAP : BAR_NORMAL}
        value={Math.min(usage.used, usage.limit)}
        max={usage.limit}
        aria-labelledby="ai-usage-count"
      />
      {usage.used === 0 ? (
        <p className="text-muted-foreground">
          You haven&apos;t used any AI generations yet. They&apos;ll show here as you create.
        </p>
      ) : null}
      {atCap ? (
        <p>
          You&apos;ve reached your limit for now. Your allowance frees up as generations age past 24 hours.
        </p>
      ) : null}
      <p className="text-muted-foreground">
        Generations that fail because of a service problem don&apos;t count against your allowance.
      </p>
    </div>
  );
}

export function AiUsageSection() {
  return (
    <section className="card stack-sm" aria-labelledby="settings-ai-usage">
      <h2 id="settings-ai-usage" className="text-heading">
        AI usage
      </h2>
      <Suspense fallback={<SectionSkeleton lines={3} />}>
        <AiUsageDetails />
      </Suspense>
    </section>
  );
}
