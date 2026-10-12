import { auth } from "@clerk/nextjs/server";
import { logEvent } from "@/lib/observability/log";
import { getOnboardingState } from "@/lib/services/creator-profile";
import { getCreatorStrategy, isStrategyErrorCode, STRATEGY_ERRORS } from "@/lib/services/creator-strategy";
import { createUserClient } from "@/lib/supabase/server";
import { FinishSetupCard } from "./finish-setup-card";
import { GenerateStrategyControl } from "./generate-strategy-control";
import { StrategyView } from "./strategy-view";

function LoadError() {
  return (
    <div role="alert" className="card max-w-2xl stack-sm">
      <h2 className="text-heading">We couldn&apos;t load your strategy</h2>
      <p className="text-muted-foreground">Something went wrong on our side. Refresh the page to try again.</p>
    </div>
  );
}

/** Session-bound part of /app/strategy: one of not onboarded, no strategy, strategy, or load error. */
export async function StrategyContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "strategy_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const [onboarding, stored] = await Promise.all([getOnboardingState(client, userId), getCreatorStrategy(client, userId)]);
  if (!onboarding.ok || !stored.ok) return <LoadError />;

  if (stored.strategy) return <StrategyView strategy={stored.strategy} />;
  if (onboarding.data.status !== "completed") return <FinishSetupCard headingId="strategy-setup" />;

  // Carried over from onboarding when the first generation failed. Only known
  // codes are accepted; the message always comes from our own table.
  const raw = (await searchParams).error;
  const code = typeof raw === "string" && isStrategyErrorCode(raw) ? raw : null;

  return (
    <section className="card max-w-2xl stack-sm" aria-labelledby="strategy-empty">
      <h2 id="strategy-empty" className="text-heading">
        Build your strategy
      </h2>
      <p className="text-muted-foreground">
        Your profile and voice are saved. We&apos;ll turn them into your positioning, 3–5 content pillars, a format
        plan for each platform and your first 30 days. It uses 1 AI generation.
      </p>
      <GenerateStrategyControl mode="generate" initialError={code ? STRATEGY_ERRORS[code] : null} />
    </section>
  );
}
