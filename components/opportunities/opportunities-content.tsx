import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { formatDay, formatTime, localDateKey, localTimeKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { opportunityView, type OpportunityView, type StoredOpportunity } from "@/lib/schemas/opportunities";
import { getTimezone } from "@/lib/services/calendar";
import { getOnboardingState } from "@/lib/services/creator-profile";
import { listOpportunities, type OpportunityCounts } from "@/lib/services/opportunities";
import { createUserClient } from "@/lib/supabase/server";
import { FinishSetupCard } from "../strategy/finish-setup-card";
import { GenerateOpportunitiesControl } from "./generate-opportunities-control";
import { OpportunityCard, type PlannedSchedule } from "./opportunity-card";

const VIEWS: { view: OpportunityView; label: string }[] = [
  { view: "new", label: "New" },
  { view: "saved", label: "Saved" },
  { view: "dismissed", label: "Dismissed" },
];

const EMPTY: Record<OpportunityView, string> = {
  new: "No ideas waiting. Generate a batch based on your strategy.",
  saved: "Ideas you save will show up here, including the ones on your calendar.",
  dismissed: "Nothing dismissed.",
};

function LoadError() {
  return (
    <div role="alert" className="card max-w-3xl stack-sm">
      <h2 className="text-heading">We couldn&apos;t load your ideas</h2>
      <p className="text-muted-foreground">Something went wrong on our side. Refresh the page to try again.</p>
    </div>
  );
}

function ViewTabs({ current, counts }: { current: OpportunityView; counts: OpportunityCounts }) {
  return (
    <nav aria-label="Opportunity views" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex gap-2">
        {VIEWS.map(({ view, label }) => {
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={view === "new" ? "/app/opportunities" : `/app/opportunities?view=${view}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-pill border px-4 text-sm font-semibold ${
                  active ? "border-foreground bg-surface-muted" : "border-border hover:border-muted-foreground"
                }`}
              >
                {label}
                <span className="text-muted-foreground">{counts[view]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Session-bound part of /app/opportunities: not set up, no strategy, a view's list, or load error. */
export async function OpportunitiesContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth.protect();

  // Allow-listed: anything else falls back to the default view.
  const parsedView = opportunityView.safeParse((await searchParams).view);
  const view: OpportunityView = parsedView.success ? parsedView.data : "new";

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "opportunity_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const result = await listOpportunities(client, userId, view);
  if (!result.ok) return <LoadError />;

  if (!result.hasStrategy && result.counts.new + result.counts.saved + result.counts.dismissed === 0) {
    const onboarding = await getOnboardingState(client, userId);
    if (!onboarding.ok) return <LoadError />;
    if (onboarding.data.status !== "completed") return <FinishSetupCard headingId="opportunities-setup" />;
    return (
      <section className="card max-w-3xl stack-sm" aria-labelledby="opportunities-no-strategy">
        <h2 id="opportunities-no-strategy" className="text-heading">
          Build your strategy first
        </h2>
        <p className="text-muted-foreground">
          Ideas are matched to your content pillars and platforms, so we need your strategy before we can suggest
          what to make.
        </p>
        <div>
          <Link href="/app/strategy" className="btn btn-primary w-full sm:w-auto">
            Go to my strategy
          </Link>
        </div>
      </section>
    );
  }

  // Planned ideas show their calendar date in the creator's own timezone.
  let timezone: string | null = null;
  if (result.items.some((idea) => idea.status === "planned")) {
    const tz = await getTimezone(client, userId);
    timezone = tz.ok ? tz.timezone : null;
  }
  const scheduleFor = (idea: StoredOpportunity): PlannedSchedule | null => {
    if (idea.status !== "planned") return null;
    const date = idea.scheduled_for && timezone ? localDateKey(idea.scheduled_for, timezone) : null;
    const time = idea.scheduled_for && timezone ? localTimeKey(idea.scheduled_for, timezone) : null;
    if (!date || !time) return { label: null, href: "/app/calendar" };
    return { label: `${formatDay(date)}, ${formatTime(time)}`, href: `/app/calendar?week=${date}` };
  };

  const canGenerate = view === "new" && result.hasStrategy;
  const empty = result.items.length === 0;
  const backlog = result.counts.new;

  return (
    <div className="stack-md max-w-3xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="stack-sm min-w-0">
          <ViewTabs current={view} counts={result.counts} />
          {view === "new" && backlog > 0 ? (
            <p className="field-help">
              {backlog === 1 ? "1 idea waiting for review" : `${backlog} ideas waiting for review`}
            </p>
          ) : null}
        </div>
        {/* One fixed position: if it moved between the header and the empty
            state, a successful run would unmount it before its toast. */}
        {canGenerate ? <GenerateOpportunitiesControl /> : null}
      </div>

      {empty ? (
        <section className="card stack-sm" aria-label="No ideas">
          <p>{EMPTY[view]}</p>
        </section>
      ) : (
        <ul className="stack-md" aria-label="Ideas">
          {result.items.map((idea) => (
            <li key={idea.id}>
              <OpportunityCard idea={idea} schedule={scheduleFor(idea)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
