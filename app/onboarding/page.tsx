import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { SectionSkeleton } from "@/components/settings/section-skeleton";
import { logEvent } from "@/lib/observability/log";
import { getOnboardingState } from "@/lib/services/creator-profile";
import { getCreatorStrategy } from "@/lib/services/creator-strategy";
import { ensureCurrentUser } from "@/lib/services/current-user";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your profile" };

function LoadError() {
  return (
    <div role="alert" className="card stack-sm">
      <h1 className="text-heading">We couldn&apos;t load your profile</h1>
      <p className="text-muted-foreground">Something went wrong on our side. Refresh the page to try again.</p>
    </div>
  );
}

// Session-bound, so it sits behind Suspense (Cache Components). Also the
// re-entry point for "Edit profile": saved answers are prefilled.
async function Onboarding() {
  const { userId } = await auth.protect();
  // Outside the /app layout, so create the `users` row here for new sign-ups.
  await ensureCurrentUser(userId);

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "profile_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const [state, stored] = await Promise.all([getOnboardingState(client, userId), getCreatorStrategy(client, userId)]);
  if (!state.ok) return <LoadError />;

  const { profile, brand } = state.data;
  // Only picks the step-2 button label; the action decides on the server
  // whether to build a strategy. An unreadable strategy counts as existing,
  // matching the action's fail-safe.
  const hasStrategy = !stored.ok || stored.strategy !== null;
  return (
    <OnboardingForm profile={profile} brand={brand} startStep={profile && !brand ? 2 : 1} hasStrategy={hasStrategy} />
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="stack-md">
          <SectionSkeleton lines={2} />
          <div className="card">
            <SectionSkeleton lines={6} />
          </div>
        </div>
      }
    >
      <Onboarding />
    </Suspense>
  );
}
