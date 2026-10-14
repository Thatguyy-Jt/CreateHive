import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";
import { TimezoneForm } from "@/components/calendar/timezone-form";
import { timezoneOptions } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { getTimezone } from "@/lib/services/calendar";
import { createUserClient } from "@/lib/supabase/server";
import { SectionSkeleton } from "./section-skeleton";

const READ_FAILED = "We couldn't load your timezone right now. Refresh to try again.";

async function TimezoneDetails() {
  // Identity from Clerk's server session only.
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "timezone_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <p>{READ_FAILED}</p>;
  }

  const result = await getTimezone(client, userId);
  if (!result.ok) {
    if (result.code !== "missing_profile") return <p>{READ_FAILED}</p>;
    return (
      <p>
        <Link href="/onboarding" className="link">
          Finish setting up your profile
        </Link>{" "}
        first, then choose your timezone.
      </p>
    );
  }

  return (
    <div className="stack-sm">
      {result.timezone ? (
        <p>
          Current: <strong>{result.timezone.replaceAll("_", " ")}</strong>
        </p>
      ) : (
        <p className="text-muted-foreground">Not set yet.</p>
      )}
      <TimezoneForm id="settings" options={timezoneOptions()} current={result.timezone} submitLabel="Save timezone" />
    </div>
  );
}

export function TimezoneSection() {
  return (
    <section className="card stack-sm" aria-labelledby="settings-timezone">
      <h2 id="settings-timezone" className="text-heading">
        Timezone
      </h2>
      <p className="text-muted-foreground">Your calendar week and &ldquo;today&rdquo; follow this timezone.</p>
      <Suspense fallback={<SectionSkeleton lines={2} />}>
        <TimezoneDetails />
      </Suspense>
    </section>
  );
}
