import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { isAiEnabled } from "@/lib/ai/env";
import { HEADLINE_KIND } from "@/lib/billing/features";
import { logEvent } from "@/lib/observability/log";
import { getPlanUsage } from "@/lib/services/ai-usage";
import { createUserClient } from "@/lib/supabase/server";
import { UpgradeButton } from "../billing/upgrade-button";
import { UsageMeter } from "../billing/usage-meter";
import { SectionSkeleton } from "./section-skeleton";

const READ_FAILED = "We couldn't load your usage right now. Refresh to try again.";

async function PlanUsageDetails() {
  // Usage depends on the current time, so it must never be prerendered.
  await connection();
  // Identity from Clerk's server session only.
  const { userId } = await auth.protect();

  let client;
  try {
    // Acts as the creator: RLS limits the reads to their own rows.
    client = createUserClient();
  } catch (error) {
    logEvent("error", "ai_usage_read_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    return <p>{READ_FAILED}</p>;
  }

  // The same plan and counts the AI service enforces.
  const { allowance, monthly } = await getPlanUsage(client, userId);
  const headline = monthly.ok ? monthly.features.find((feature) => feature.kind === HEADLINE_KIND) : undefined;
  const free = allowance.plan.id === "free";

  return (
    <div className="stack-md">
      <p>
        You&apos;re on the <strong>{allowance.plan.name}</strong> plan.
      </p>
      {!isAiEnabled() ? <p>AI features are paused right now.</p> : null}
      {headline ? (
        <UsageMeter id="settings-usage-headline" feature={headline} />
      ) : (
        <p className="text-muted-foreground">{READ_FAILED}</p>
      )}
      <p className="field-help">
        Allowances count uses in the last 30 days. Uses that fail because of a service problem don&apos;t count.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {free ? <UpgradeButton /> : null}
        <Link href="/app/settings/billing" className="link link-arrow font-semibold">
          {free ? "See all plan limits" : "Manage billing"}
        </Link>
      </div>
    </div>
  );
}

export function AiUsageSection() {
  return (
    <section className="card stack-sm" aria-labelledby="settings-plan-usage">
      <h2 id="settings-plan-usage" className="text-heading">
        Plan &amp; usage
      </h2>
      <Suspense fallback={<SectionSkeleton lines={3} />}>
        <PlanUsageDetails />
      </Suspense>
    </section>
  );
}
