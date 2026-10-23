import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { isAiEnabled } from "@/lib/ai/env";
import { endsSoon } from "@/lib/billing/entitlement";
import { HEADLINE_KIND } from "@/lib/billing/features";
import { formatBillingDate } from "@/lib/billing/format";
import { logEvent } from "@/lib/observability/log";
import { getPlanUsage } from "@/lib/services/ai-usage";
import { createUserClient } from "@/lib/supabase/server";
import { UpgradeButton } from "../billing/upgrade-button";

/** Same height as the line, so nothing shifts when it loads (or is left out). */
export function AiUsageLineFallback() {
  return (
    <p className="field-help" aria-hidden="true">
      &nbsp;
    </p>
  );
}

/** One line of plan usage, counted as the AI service counts it. Secondary: on failure it's left out. */
export async function AiUsageLine() {
  // Usage depends on the current time, so it must never be prerendered.
  await connection();
  const { userId } = await auth.protect();

  if (!isAiEnabled()) return <p className="field-help">AI features are paused right now.</p>;

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

  const { now, allowance, monthly } = await getPlanUsage(client, userId);
  const headline = monthly.ok ? monthly.features.find((feature) => feature.kind === HEADLINE_KIND) : undefined;
  if (!headline) return <AiUsageLineFallback />;

  const { entitlement } = allowance;
  return (
    <>
      <p className="field-help">
        {headline.used} of {headline.limit} {headline.plural} used this month · {allowance.plan.name} plan ·{" "}
        {allowance.plan.id === "free" ? (
          <UpgradeButton variant="link" />
        ) : (
          <Link href="/app/settings/billing" className="link">
            Details
          </Link>
        )}
      </p>
      {entitlement.paid && entitlement.endsAt && endsSoon(entitlement, now) ? (
        <p className="field-help">
          Your {allowance.plan.name} plan ends on {formatBillingDate(entitlement.endsAt, null)}.{" "}
          <Link href="/app/settings/billing" className="link font-semibold">
            Renew
          </Link>
        </p>
      ) : null}
    </>
  );
}
