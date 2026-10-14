import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { isAiEnabled, readDailyGenerationLimit } from "@/lib/ai/env";
import { logEvent } from "@/lib/observability/log";
import { getAiUsage } from "@/lib/services/ai-usage";
import { createUserClient } from "@/lib/supabase/server";

/** Same height as the line, so nothing shifts when it loads (or is left out). */
export function AiUsageLineFallback() {
  return (
    <p className="field-help" aria-hidden="true">
      &nbsp;
    </p>
  );
}

/** One line of AI usage, counted as Settings counts it. Secondary: on failure it's left out. */
export async function AiUsageLine() {
  // The count depends on the current time, so it must never be prerendered.
  await connection();
  const { userId } = await auth.protect();

  if (!isAiEnabled()) return <p className="field-help">AI features are paused right now.</p>;

  const limit = readDailyGenerationLimit();
  if (limit === null) {
    logEvent("error", "ai_usage_read_failed", { stage: "config", variables: ["AI_DAILY_GENERATION_LIMIT"] });
    return <AiUsageLineFallback />;
  }

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "ai_usage_read_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    return <AiUsageLineFallback />;
  }

  const usage = await getAiUsage(client, userId, limit);
  if (!usage.ok) return <AiUsageLineFallback />;

  return (
    <p className="field-help">
      {usage.used} of {usage.limit} AI generations used in the last 24 hours ·{" "}
      <Link href="/app/settings" className="link">
        Details
      </Link>
    </p>
  );
}
