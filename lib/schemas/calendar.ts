import { z } from "zod";
import { addDays, isDateKey, isTimeKey, isValidTimezone, weekStart } from "@/lib/calendar/dates";
import { platform } from "./creator";
import { contentItemStatus, difficulty } from "./enums";

// Calendar (scheduled `content_items`) and the weekly plan proposal.

/** Most ideas scheduled in one request (manual or an accepted plan). */
export const MAX_SLOTS_PER_REQUEST = 20;
/** Furthest ahead an item can be scheduled. Mirrors `schedule_content_ideas`. */
export const MAX_DAYS_AHEAD = 180;
/** How far in the past a time may be and still count as "now". Mirrors `schedule_content_ideas`. */
export const PAST_GRACE_MS = 60 * 60 * 1000;
/** Default time for new items. We don't recommend posting times. */
export const DEFAULT_TIME = "09:00";
/** Most items the weekly plan puts on one day, counting what's already scheduled. */
export const MAX_PER_DAY = 2;

export const dateKey = z.string().refine(isDateKey, { error: "Choose a valid date." });
export const timeKey = z.string().refine(isTimeKey, { error: "Choose a valid time." });

export const timezoneInput = z
  .string()
  .trim()
  .refine(isValidTimezone, { error: "Choose a timezone from the list." });

export const scheduleSlotInput = z.object({ idea_id: z.uuid(), date: dateKey, time: timeKey });
export type ScheduleSlotInput = z.infer<typeof scheduleSlotInput>;

/**
 * A batch of slots for a creator whose local date is `today`: 1 to 20 slots,
 * no duplicate ideas, no past dates, at most 180 days ahead. The exact
 * instant is checked again after conversion, and again in the database.
 */
export function scheduleInputFor(today: string) {
  const latest = addDays(today, MAX_DAYS_AHEAD) ?? today;
  return z
    .array(
      scheduleSlotInput.superRefine((slot, ctx) => {
        if (slot.date < today) ctx.addIssue({ code: "custom", path: ["date"], message: "date_past" });
        else if (slot.date > latest) ctx.addIssue({ code: "custom", path: ["date"], message: "date_too_far" });
      }),
    )
    .min(1)
    .max(MAX_SLOTS_PER_REQUEST)
    .refine((slots) => new Set(slots.map((slot) => slot.idea_id)).size === slots.length, {
      error: "duplicate_idea",
    });
}

/** `?week=`: any date in the week, strictly `YYYY-MM-DD`; anything else is this week. Returns the Monday. */
export function parseWeekParam(raw: unknown, today: string): string {
  return (isDateKey(raw) ? weekStart(raw) : null) ?? weekStart(today) ?? today;
}

/** A scheduled item as the calendar shows it, re-validated on read. */
export const storedCalendarItem = z.object({
  id: z.string(),
  idea_id: z.string().nullable(),
  title: z.string(),
  platform: platform.nullable(),
  format: z.string().nullable(),
  status: contentItemStatus,
  scheduled_for: z.string(),
  pillar_name: z.string().nullable(),
  hook: z.string().nullable(),
});
export type StoredCalendarItem = z.infer<typeof storedCalendarItem>;

/** A saved idea waiting to be scheduled. */
export const unscheduledIdea = z.object({
  id: z.string(),
  topic: z.string(),
  hook: z.string().nullable(),
  format: z.string().nullable(),
  platform: platform.nullable(),
  difficulty: difficulty.nullable(),
  pillar_name: z.string().nullable(),
});
export type UnscheduledIdea = z.infer<typeof unscheduledIdea>;

// ---------------------------------------------------------------------------
// Weekly plan (proposal only; nothing is stored until the creator accepts)
// ---------------------------------------------------------------------------

/**
 * Model-facing schema. Every key is required (OpenAI strict mode). `idea_ref`
 * may only be one of this request's refs and `date` one of the open dates.
 */
export function weeklyPlanModelSchemaFor(refs: readonly string[], dates: readonly string[]) {
  return z.object({
    slots: z.array(
      z.object({
        idea_ref: z.enum(refs as [string, ...string[]]),
        date: z.enum(dates as [string, ...string[]]),
        reason: z.string(),
      }),
    ),
    note: z.string().nullable(),
  });
}
export type WeeklyPlanModelOutput = z.infer<ReturnType<typeof weeklyPlanModelSchemaFor>>;

/** App-level validation of a proposal for one creator's week. */
export function weeklyPlanOutputFor(options: {
  refs: readonly string[];
  /** The seven dates of the target week. */
  dates: readonly string[];
  remainingCapacity: number;
  /** The creator's local date: earlier days are closed. */
  today: string;
  /** Items already scheduled per date, counted towards the per-day limit. */
  scheduledPerDay?: Readonly<Record<string, number>>;
}) {
  const refs = new Set(options.refs);
  const dates = new Set(options.dates);
  const existing = options.scheduledPerDay ?? {};

  return z
    .object({
      slots: z
        .array(
          z.object({
            idea_ref: z.string().refine((ref) => refs.has(ref), { error: "Unknown idea ref." }),
            date: z
              .string()
              .refine((date) => dates.has(date), { error: "Date is outside the week." })
              .refine((date) => date >= options.today, { error: "Date has passed." }),
            reason: z.string().trim().min(1).max(200),
          }),
        )
        .max(Math.max(0, options.remainingCapacity), { error: "More slots than the remaining capacity." })
        .refine((slots) => new Set(slots.map((slot) => slot.idea_ref)).size === slots.length, {
          error: "Each idea can be used once.",
        })
        .refine(
          (slots) => {
            const perDay = new Map<string, number>();
            for (const slot of slots) perDay.set(slot.date, (perDay.get(slot.date) ?? 0) + 1);
            return [...perDay].every(([date, count]) => count + (existing[date] ?? 0) <= MAX_PER_DAY);
          },
          { error: `At most ${MAX_PER_DAY} items per day.` },
        ),
      note: z
        .string()
        .trim()
        .max(300)
        .nullable()
        .transform((value) => (value ? value : null)),
    })
    .refine((plan) => plan.slots.length > 0 || plan.note !== null, {
      error: "An empty plan must explain why.",
      path: ["note"],
    });
}
export type WeeklyPlanOutput = z.infer<ReturnType<typeof weeklyPlanOutputFor>>;

/** A proposed slot as the page shows it and posts back on accept. */
export interface ProposedSlot {
  idea_id: string;
  date: string;
  time: string;
  reason: string;
  idea: Pick<UnscheduledIdea, "topic" | "pillar_name" | "platform" | "format" | "difficulty">;
}
