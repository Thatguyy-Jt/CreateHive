import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import type { WeeklyPlanDay, WeeklyPlanIdea } from "@/lib/ai/prompts/weekly_plan/v1";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { daysBetween, formatWeekday, isDateKey, localDateKey, weekDays, weekStart } from "@/lib/calendar/dates";
import { planWeekNumber } from "@/lib/calendar/plan-week";
import { logEvent } from "@/lib/observability/log";
import {
  DEFAULT_TIME,
  MAX_DAYS_AHEAD,
  weeklyPlanModelSchemaFor,
  weeklyPlanOutputFor,
  type ProposedSlot,
  type WeeklyPlanModelOutput,
  type WeeklyPlanOutput,
} from "@/lib/schemas/calendar";
import { formatStrategy, platform as platformSchema, thirtyDayPlan } from "@/lib/schemas/creator";
import { parseWith } from "@/lib/schemas/parse";
import type { Database } from "@/lib/supabase/database.types";
import { listWeek } from "./calendar";

type PlanClient = Pick<SupabaseClient<Database>, "from">;

/** A weekly-plan generation still pending inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** Most saved ideas sent to the model (the newest). */
export const PLAN_IDEAS_LIMIT = 30;

export type WeeklyPlanErrorCode =
  | AiErrorCode
  | "missing_context"
  | "missing_timezone"
  | "invalid_week"
  | "no_saved_ideas"
  | "week_full"
  | "in_progress";

export type GenerateWeeklyPlanResult =
  | { ok: true; slots: ProposedSlot[]; note: string | null }
  | { ok: false; code: WeeklyPlanErrorCode; message: string; retryable: boolean };

/** Creator-facing messages: what happened and what to do next. */
export const WEEKLY_PLAN_ERRORS: Record<WeeklyPlanErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  invalid_output: { message: "Your suggested week didn't come out right. Please try again.", retryable: true },
  persistence_error: {
    message: "We couldn't suggest a week right now. Please try again in a moment.",
    retryable: true,
  },
  limit_reached: {
    message:
      "You've used all of your AI generations for now. Your allowance frees up as generations age past 24 hours. You can still schedule ideas by hand.",
    retryable: false,
  },
  missing_context: {
    message: "Build your strategy first, so your week can follow your pillars and posting capacity.",
    retryable: false,
  },
  missing_timezone: {
    message: "Confirm your timezone first, so your days line up with your week.",
    retryable: false,
  },
  invalid_week: {
    message: `You can plan this week or any week up to ${MAX_DAYS_AHEAD} days ahead.`,
    retryable: false,
  },
  no_saved_ideas: {
    message: "Save some ideas first, then we can arrange them into your week. No AI generation was used.",
    retryable: false,
  },
  week_full: {
    message: "This week is already full for your posting capacity. No AI generation was used.",
    retryable: false,
  },
  in_progress: {
    message: "We're already suggesting a week for you. Give it a minute, then try again.",
    retryable: false,
  },
};

function fail(code: WeeklyPlanErrorCode): GenerateWeeklyPlanResult {
  return { ok: false, code, ...WEEKLY_PLAN_ERRORS[code] };
}

type RunWeeklyPlan = (
  request: RunStructuredRequest<"weekly_plan", WeeklyPlanModelOutput, WeeklyPlanOutput>,
) => Promise<AiResult<WeeklyPlanOutput>>;

export interface WeeklyPlanDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunWeeklyPlan;
  now?: () => number;
}

/**
 * Weekly planner: arranges the creator's saved, unscheduled ideas into one
 * week within their remaining posting capacity, through the AI service. It
 * returns a proposal and stores nothing; accepted slots are scheduled through
 * the same path as manual scheduling. Never throws.
 *
 * `client` acts as the creator (`createUserClient()`); `userId` comes from
 * Clerk's verified session. AI metering and the daily cap happen in `run`.
 */
export async function generateWeeklyPlan(
  client: PlanClient,
  userId: string,
  options: { weekStart: string },
  deps: WeeklyPlanDeps,
): Promise<GenerateWeeklyPlanResult> {
  const now = deps.now ?? Date.now;
  try {
    // 1. Profile, timezone and strategy.
    const [profile, strategy] = await Promise.all([
      client
        .from("creator_profiles")
        .select("timezone, posting_capacity_per_week, platforms, experience_level")
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("creator_strategies")
        .select("format_strategy, thirty_day_plan, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const readError = profile.error ?? strategy.error;
    if (readError) {
      logEvent("error", "weekly_plan_failed", { stage: "context", db_code: readError.code });
      return fail("persistence_error");
    }
    if (!profile.data) return fail("missing_context");
    const tz = profile.data.timezone;
    const today = tz ? localDateKey(now(), tz) : null;
    if (!tz || !today) return fail("missing_timezone");
    if (!strategy.data || !profile.data.posting_capacity_per_week) return fail("missing_context");
    const capacity = profile.data.posting_capacity_per_week;

    // 2. The target week: a Monday, not entirely past, within the scheduling window.
    const target = isDateKey(options.weekStart) ? weekStart(options.weekStart) : null;
    const dates = target ? weekDays(target) : null;
    const ahead = target ? daysBetween(today, target) : null;
    if (!target || target !== options.weekStart || !dates || ahead === null || ahead > MAX_DAYS_AHEAD || dates[6] < today) {
      return fail("invalid_week");
    }

    // 3. What's already scheduled and the ideas to arrange. No AI call without both.
    const week = await listWeek(client, userId, target, tz, now(), PLAN_IDEAS_LIMIT);
    if (!week.ok) return fail("persistence_error");
    const ideas = week.unscheduled;
    if (ideas.length === 0) return fail("no_saved_ideas");
    const remaining = capacity - week.items.length;
    if (remaining <= 0) return fail("week_full");

    // 4. In-flight guard.
    const since = new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString();
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "weekly_plan")
      .eq("status", "pending")
      .gte("created_at", since);
    if (pending.error) {
      logEvent("error", "weekly_plan_failed", { stage: "in_flight_check", db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    // 5. Input: refs instead of ids, open dates only in the schema.
    const scheduledPerDay: Record<string, number> = {};
    for (const item of week.items) scheduledPerDay[item.date] = (scheduledPerDay[item.date] ?? 0) + 1;
    const days: WeeklyPlanDay[] = dates.map((date) => ({
      date,
      weekday: formatWeekday(date) ?? date,
      past: date < today,
      scheduled: scheduledPerDay[date] ?? 0,
    }));
    const openDates = dates.filter((date) => date >= today);
    const refs = ideas.map((_, index) => `I${index + 1}`);
    const promptIdeas: WeeklyPlanIdea[] = ideas.map((idea, index) => ({
      ref: refs[index],
      topic: idea.topic,
      pillar: idea.pillar_name,
      platform: idea.platform,
      format: idea.format,
      difficulty: idea.difficulty,
      hook: idea.hook,
    }));

    const cadence = parseWith(formatStrategy, strategy.data.format_strategy);
    const plan = parseWith(thirtyDayPlan, strategy.data.thirty_day_plan);
    const planWeek = planWeekNumber(strategy.data.updated_at, target, tz);
    const theme = plan.ok && planWeek ? plan.data[planWeek - 1] : null;

    const schema = weeklyPlanOutputFor({ refs, dates, remainingCapacity: remaining, today, scheduledPerDay });
    const result = await deps.run({
      userId,
      kind: "weekly_plan",
      input: {
        postingCapacityPerWeek: capacity,
        remainingSlots: remaining,
        platforms: profile.data.platforms.filter((p) => platformSchema.safeParse(p).success),
        experienceLevel: profile.data.experience_level,
        cadence: cadence.ok ? cadence.data.map(({ platform, formats, cadence }) => ({ platform, formats, cadence })) : [],
        weekTheme: theme && planWeek ? { week: planWeek, theme: theme.theme, focus: theme.focus } : null,
        days,
        scheduled: week.items.map((item) => ({
          title: item.title,
          pillar: item.pillar_name,
          platform: item.platform,
          date: item.date,
        })),
        ideas: promptIdeas,
      },
      schema: weeklyPlanModelSchemaFor(refs, openDates),
      validate: (output) => parseWith(schema, output),
    });
    if (!result.ok) {
      logEvent("error", "weekly_plan_failed", { stage: "ai", code: result.code });
      return fail(result.code);
    }

    // 6. Refs back to the creator's ideas. Nothing is stored.
    const byRef = new Map(refs.map((ref, index) => [ref, ideas[index]]));
    const slots: ProposedSlot[] = result.data.slots
      .map((slot) => {
        const idea = byRef.get(slot.idea_ref)!;
        return {
          idea_id: idea.id,
          date: slot.date,
          time: DEFAULT_TIME,
          reason: slot.reason,
          idea: {
            topic: idea.topic,
            pillar_name: idea.pillar_name,
            platform: idea.platform,
            format: idea.format,
            difficulty: idea.difficulty,
          },
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, slots, note: result.data.note };
  } catch (error) {
    logEvent("error", "weekly_plan_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return fail("persistence_error");
  }
}
