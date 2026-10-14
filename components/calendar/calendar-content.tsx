import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import {
  addDays,
  formatDay,
  formatWeekRange,
  shiftWeek,
  timezoneOptions,
  todayIn,
  weekDays,
  weekStart as weekStartOf,
} from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { MAX_DAYS_AHEAD, parseWeekParam } from "@/lib/schemas/calendar";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getCalendarSetup, listWeek, type CalendarItem } from "@/lib/services/calendar";
import { WEEKLY_PLAN_ERRORS } from "@/lib/services/weekly-plan";
import { createUserClient } from "@/lib/supabase/server";
import { FinishSetupCard } from "../strategy/finish-setup-card";
import { CalendarItemCard } from "./calendar-item-card";
import { ScheduleIdeaForm } from "./schedule-idea-form";
import { TimezoneForm } from "./timezone-form";
import { WeekPlanner } from "./week-planner";

function LoadError() {
  return (
    <div role="alert" className="card max-w-3xl stack-sm">
      <h2 className="text-heading">We couldn&apos;t load your calendar</h2>
      <p className="text-muted-foreground">Something went wrong on our side. Refresh the page to try again.</p>
    </div>
  );
}

const weekHref = (start: string) => `/app/calendar?week=${start}`;

function WeekBar({ start, thisWeek, label }: { start: string; thisWeek: string; label: string }) {
  const previous = shiftWeek(start, -1)!;
  const next = shiftWeek(start, 1)!;
  const linkClass = "btn btn-secondary btn-sm";
  return (
    <nav aria-label="Week" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-heading" aria-live="polite">
        {label}
      </p>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href={weekHref(previous)} className={linkClass}>
            <span aria-hidden="true">←</span> Previous<span className="sr-only"> week</span>
          </Link>
        </li>
        <li>
          <Link href="/app/calendar" className={linkClass} aria-current={start === thisWeek ? "page" : undefined}>
            This week
          </Link>
        </li>
        <li>
          <Link href={weekHref(next)} className={linkClass}>
            Next<span className="sr-only"> week</span> <span aria-hidden="true">→</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}

function CapacityLine({ scheduled, capacity }: { scheduled: number; capacity: number | null }) {
  if (!capacity) return <p className="field-help">{scheduled === 1 ? "1 item" : `${scheduled} items`} this week</p>;
  const over = scheduled > capacity;
  return (
    <p className={over ? "text-sm font-semibold text-warning" : "field-help"}>
      {scheduled} of {capacity} this week
      {over ? " · more than the posts per week you planned for" : null}
    </p>
  );
}

function DaySection({ date, today, items, min, max }: { date: string; today: string; items: CalendarItem[]; min: string; max: string }) {
  const isToday = date === today;
  const headingId = `day-${date}`;
  // Agenda row: the date on the left from lg up, the day's items in a grid beside it.
  return (
    <section
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col gap-3 rounded-md border p-4 lg:grid lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-start lg:gap-6 ${
        isToday ? "border-2 border-foreground" : "border-border"
      }`}
    >
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-base font-bold lg:flex-col lg:gap-1">
        {formatDay(date)}
        {isToday ? (
          <span className="rounded-pill border border-foreground px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
            Today
          </span>
        ) : null}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground lg:pt-0.5">Nothing planned</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <CalendarItemCard item={item} min={min} max={max} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Session-bound part of /app/calendar: not set up, no strategy, timezone confirm, the week, or load error. */
export async function CalendarContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // "Today" and "date passed" depend on the current time: never prerender.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "calendar_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const setupResult = await getCalendarSetup(client, userId);
  if (!setupResult.ok) return <LoadError />;
  const { setup } = setupResult;

  if (!setup.onboarded) return <FinishSetupCard headingId="calendar-setup" />;
  if (!setup.hasStrategy) {
    return (
      <section className="card max-w-3xl stack-sm" aria-labelledby="calendar-no-strategy">
        <h2 id="calendar-no-strategy" className="text-heading">
          Build your strategy first
        </h2>
        <p className="text-muted-foreground">
          Your calendar plans the ideas you save, and ideas come from your strategy&apos;s content pillars.
        </p>
        <div>
          <Link href="/app/strategy" className="btn btn-primary w-full sm:w-auto">
            Go to my strategy
          </Link>
        </div>
      </section>
    );
  }
  if (!setup.timezone) {
    return (
      <section className="card card-offset max-w-3xl stack-sm" aria-labelledby="calendar-timezone">
        <h2 id="calendar-timezone" className="text-heading">
          Confirm your timezone
        </h2>
        <p className="text-muted-foreground">
          Your week runs Monday to Sunday in your own time, so &ldquo;today&rdquo; and each day&apos;s plan line up
          with where you are. You can change it later in Settings.
        </p>
        <TimezoneForm id="calendar" options={timezoneOptions()} current={null} submitLabel="Confirm timezone" />
      </section>
    );
  }

  const tz = setup.timezone;
  const today = todayIn(tz);
  if (!today) return <LoadError />;
  const thisWeek = weekStartOf(today)!;
  const start = parseWeekParam((await searchParams).week, today);
  const dates = weekDays(start)!;
  const latest = addDays(today, MAX_DAYS_AHEAD)!;

  const week = await listWeek(client, userId, start, tz);
  if (!week.ok) return <LoadError />;

  const byDay = new Map<string, CalendarItem[]>(dates.map((date) => [date, []]));
  for (const item of week.items) byDay.get(item.date)?.push(item);

  const scheduled = week.items.length;
  const capacity = setup.postingCapacityPerWeek;
  const weekPast = dates[6] < today;
  const tooFar = start > latest;
  const unavailable = weekPast
    ? "This week has passed. Plan this week or a later one."
    : tooFar
      ? WEEKLY_PLAN_ERRORS.invalid_week.message
      : week.unscheduled.length === 0
        ? "Save some ideas first, then we can arrange them into your week."
        : capacity && scheduled >= capacity
          ? "This week is full for your posting capacity. You can still schedule ideas by hand."
          : null;
  // New items default to the first day of the viewed week that's still ahead.
  const defaultDate = start > today ? start : (addDays(today, 1) ?? today);

  return (
    <div className="stack-md">
      <div className="stack-sm max-w-3xl">
        <WeekBar start={start} thisWeek={thisWeek} label={formatWeekRange(start) ?? start} />
        <CapacityLine scheduled={scheduled} capacity={capacity} />
        <p className="field-help">
          Times are in {tz.replaceAll("_", " ")}.{" "}
          <Link href="/app/settings" className="link">
            Change timezone
          </Link>
        </p>
      </div>

      <WeekPlanner key={start} weekStart={start} unavailable={unavailable} />

      {scheduled === 0 ? (
        <p className="max-w-3xl text-muted-foreground">
          Nothing planned this week. Schedule a saved idea or suggest a week.
        </p>
      ) : null}

      <div className="stack-sm max-w-6xl">
        {dates.map((date) => (
          <DaySection key={date} date={date} today={today} items={byDay.get(date) ?? []} min={today} max={latest} />
        ))}
      </div>

      <section className="stack-md max-w-3xl" aria-labelledby="calendar-unscheduled">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="calendar-unscheduled" className="text-heading">
            Unscheduled saved ideas
          </h2>
          <Link href="/app/opportunities?view=saved" className="link">
            All saved ideas
          </Link>
        </div>
        {week.unscheduled.length === 0 ? (
          <div className="card stack-sm">
            <p>Save some ideas first, then plan your week.</p>
            <div>
              <Link href="/app/opportunities" className="btn btn-secondary w-full sm:w-auto">
                Go to Opportunities
              </Link>
            </div>
          </div>
        ) : (
          <ul className="stack-md" aria-label="Unscheduled saved ideas">
            {week.unscheduled.map((idea) => {
              const meta = [idea.platform ? PLATFORM_LABELS[idea.platform] : null, idea.format].filter(Boolean).join(" · ");
              return (
                <li key={idea.id}>
                  <article className="card stack-sm" aria-labelledby={`unscheduled-${idea.id}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                      {idea.pillar_name ? (
                        <span className="rounded-pill border border-border px-3 py-1 font-semibold">{idea.pillar_name}</span>
                      ) : null}
                      {meta ? <span className="text-muted-foreground">{meta}</span> : null}
                    </div>
                    <h3 id={`unscheduled-${idea.id}`} className="text-lg font-bold break-words">
                      {idea.topic}
                    </h3>
                    {idea.hook ? (
                      <blockquote className="border-l-4 border-accent pl-4 font-accent text-lg italic break-words">
                        {idea.hook}
                      </blockquote>
                    ) : null}
                    <ScheduleIdeaForm ideaId={idea.id} defaultDate={defaultDate} min={today} max={latest} />
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
