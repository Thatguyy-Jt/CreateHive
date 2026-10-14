import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ScheduleIdeaForm } from "@/components/calendar/schedule-idea-form";
import { addDays, formatLongDay, formatTime } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { MAX_DAYS_AHEAD } from "@/lib/schemas/calendar";
import { getDailyRecommendation, type Recommendation } from "@/lib/services/daily-recommendation";
import { createUserClient } from "@/lib/supabase/server";
import { IdeaMeta, IdeaSummary } from "./idea-summary";
import { NextIdeaCard } from "./next-idea-card";

const HEADING_ID = "dashboard-today";

/** "What should I do today?" and, when it adds something, the next idea. */
export async function DashboardToday() {
  // "Today" depends on the current time, so this must never be prerendered.
  await connection();
  // Identity from Clerk's server session only.
  const { userId } = await auth.protect();

  let client;
  try {
    // Acts as the creator: RLS limits every read to their own rows.
    client = createUserClient();
  } catch (error) {
    logEvent("error", "daily_recommendation_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    return <TodayError />;
  }

  const result = await getDailyRecommendation(client, userId);
  if (!result.ok) return <TodayError />;
  const { today, recommendation, nextIdea } = result;

  // Setup steps: the strategy card below already shows the existing setup card.
  if (recommendation.kind === "finish_setup" || recommendation.kind === "build_strategy") return null;

  return (
    <>
      <TodayCard today={today} recommendation={recommendation} />
      {nextIdea ? <NextIdeaCard idea={nextIdea} /> : null}
    </>
  );
}

function TodayFrame({ today, children }: { today: string | null; children: ReactNode }) {
  const label = today ? formatLongDay(today) : null;
  return (
    <section className="card card-offset stack-sm" aria-labelledby={HEADING_ID}>
      <div>
        <h2 id={HEADING_ID} className="text-heading">
          What should I do today?
        </h2>
        {label ? <p className="field-help">{label}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Action({ title, why }: { title: ReactNode; why: string }) {
  return (
    <>
      <h3 className="text-lg font-bold break-words">{title}</h3>
      <p className="text-muted-foreground">{why}</p>
    </>
  );
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div>
      <Link href={href} className="btn btn-primary w-full min-[480px]:w-auto">
        {children}
      </Link>
    </div>
  );
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function TodayCard({ today, recommendation }: { today: string | null; recommendation: Recommendation }) {
  switch (recommendation.kind) {
    case "confirm_timezone":
      return (
        <TodayFrame today={null}>
          <Action
            title="Confirm your timezone"
            why="So “today” and your week line up with where you are. It takes a few seconds."
          />
          <PrimaryLink href="/app/calendar">Confirm timezone</PrimaryLink>
        </TodayFrame>
      );

    case "make_today": {
      const { item, moreToday } = recommendation;
      const time = formatTime(item.time) ?? item.time;
      return (
        <TodayFrame today={today}>
          <Action
            title={<>Make &ldquo;{item.title}&rdquo; today</>}
            why={
              item.passed
                ? `It was on your calendar for ${time} today.`
                : `It's on your calendar for ${time} today.`
            }
          />
          <div className="stack-sm">
            <IdeaMeta pillar={item.pillar_name} platform={item.platform} format={item.format} />
            {item.hook ? (
              <blockquote className="line-clamp-2 border-l-4 border-accent pl-4 font-accent text-lg italic break-words">
                {item.hook}
              </blockquote>
            ) : null}
            <p className="field-help">
              {time}
              {item.passed ? " · Date passed" : null}
              {moreToday > 0 ? ` · and ${moreToday} more today` : null}
            </p>
          </div>
          <PrimaryLink href={`/app/studio/${item.id}`}>Open in Studio</PrimaryLink>
          <p className="field-help">
            <Link href="/app/calendar" className="link">
              Or open your calendar
            </Link>
          </p>
        </TodayFrame>
      );
    }

    case "schedule_saved": {
      const { idea, room } = recommendation;
      const min = today!;
      const max = addDays(min, MAX_DAYS_AHEAD) ?? min;
      return (
        <TodayFrame today={today}>
          <Action
            title={<>Put &ldquo;{idea.topic}&rdquo; on your calendar</>}
            why={
              room === null
                ? "Your best saved idea isn't scheduled yet."
                : `You have room for ${room} more ${plural(room, "post", "posts")} this week.`
            }
          />
          <IdeaSummary idea={idea} />
          <ScheduleIdeaForm key={idea.id} ideaId={idea.id} defaultDate={addDays(min, 1) ?? min} min={min} max={max} />
          <p className="field-help">
            <Link href="/app/calendar" className="link">
              Or let AI suggest your week
            </Link>
          </p>
        </TodayFrame>
      );
    }

    case "review_new": {
      const { idea, count } = recommendation;
      return (
        <TodayFrame today={today}>
          <Action
            title={count === 1 ? "Review your new idea" : `Review your ${count} new ideas`}
            why="Save the ones worth making and dismiss the rest. Here's the strongest one."
          />
          <IdeaSummary idea={idea} />
          <PrimaryLink href="/app/opportunities">Review ideas</PrimaryLink>
        </TodayFrame>
      );
    }

    case "plan_next_week": {
      const { nextWeek, scheduled, savedCount } = recommendation;
      return (
        <TodayFrame today={today}>
          <Action
            title="This week is planned. Plan next week"
            why={`You've scheduled ${scheduled} ${plural(scheduled, "post", "posts")} this week, and ${savedCount} saved ${plural(savedCount, "idea is", "ideas are")} ready for next week.`}
          />
          <PrimaryLink href={`/app/calendar?week=${nextWeek}`}>Plan next week</PrimaryLink>
        </TodayFrame>
      );
    }

    case "generate_ideas":
      return (
        <TodayFrame today={today}>
          <Action
            title="Find your next ideas"
            why="You have no saved or new ideas waiting. Get a fresh set based on your strategy."
          />
          <PrimaryLink href="/app/opportunities">Go to Opportunities</PrimaryLink>
        </TodayFrame>
      );

    default:
      return null;
  }
}

function TodayError() {
  return (
    <section className="card card-offset stack-sm" aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} className="text-heading">
        What should I do today?
      </h2>
      <p className="text-muted-foreground">We couldn&apos;t load today&apos;s plan. Refresh the page to try again.</p>
    </section>
  );
}
