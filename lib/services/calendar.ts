import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isValidTimezone, localDateKey, localTimeKey, localToInstant, weekRange } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import {
  MAX_DAYS_AHEAD,
  PAST_GRACE_MS,
  scheduleInputFor,
  storedCalendarItem,
  timezoneInput,
  unscheduledIdea,
  type StoredCalendarItem,
  type UnscheduledIdea,
} from "@/lib/schemas/calendar";
import { parseWith } from "@/lib/schemas/parse";
import type { Database, Json } from "@/lib/supabase/database.types";

type CalendarClient = Pick<SupabaseClient<Database>, "from" | "rpc">;
type ReadClient = Pick<SupabaseClient<Database>, "from">;

/** Saved ideas listed under the week, newest first. */
export const UNSCHEDULED_LIMIT = 50;

export type CalendarErrorCode =
  | "invalid_input"
  | "date_past"
  | "date_too_far"
  | "duplicate_idea"
  | "idea_not_found"
  | "idea_not_saved"
  | "not_found"
  | "missing_profile"
  | "missing_timezone"
  | "invalid_timezone"
  | "db_error";

/** Creator-facing messages: what happened and what to do next. */
export const CALENDAR_ERRORS: Record<CalendarErrorCode, string> = {
  invalid_input: "Check the date and time, then try again.",
  date_past: "That time has already passed. Pick a later date or time.",
  date_too_far: `You can schedule up to ${MAX_DAYS_AHEAD} days ahead. Pick an earlier date.`,
  duplicate_idea: "Each idea can only be scheduled once.",
  idea_not_found: "We couldn't find that idea. Refresh the page and try again.",
  idea_not_saved:
    "That idea is already scheduled or is no longer saved. Refresh the page to see its current state.",
  not_found: "We couldn't find that calendar item. Refresh the page and try again.",
  missing_profile: "Finish setting up your profile first.",
  missing_timezone: "Confirm your timezone first, so your days line up with your week.",
  invalid_timezone: "Choose a timezone from the list.",
  db_error: "We couldn't update your calendar. Please try again in a moment.",
};

export type CalendarFailure = { ok: false; code: CalendarErrorCode; message: string };

function fail(code: CalendarErrorCode): CalendarFailure {
  return { ok: false, code, message: CALENDAR_ERRORS[code] };
}

function dbFailed(event: string, stage: string, dbCode?: string): CalendarFailure {
  logEvent("error", event, { stage, db_code: dbCode });
  return fail("db_error");
}

function unexpected(event: string, error: unknown): CalendarFailure {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
  return fail("db_error");
}

// ---------------------------------------------------------------------------
// Timezone and setup
// ---------------------------------------------------------------------------

export type GetTimezoneResult = { ok: true; timezone: string | null } | CalendarFailure;

/** The creator's saved timezone, or null if none (or a stored value that's no longer valid). Never throws. */
export async function getTimezone(client: ReadClient, userId: string): Promise<GetTimezoneResult> {
  try {
    const row = await client.from("creator_profiles").select("timezone").eq("user_id", userId).maybeSingle();
    if (row.error) return dbFailed("timezone_read_failed", "select", row.error.code);
    if (!row.data) return fail("missing_profile");
    return { ok: true, timezone: isValidTimezone(row.data.timezone) ? row.data.timezone : null };
  } catch (error) {
    return unexpected("timezone_read_failed", error);
  }
}

/** Validates and stores the creator's timezone. Never throws. */
export async function saveTimezone(
  client: ReadClient,
  userId: string,
  tz: unknown,
): Promise<{ ok: true; timezone: string } | CalendarFailure> {
  const parsed = timezoneInput.safeParse(tz);
  if (!parsed.success) return fail("invalid_timezone");
  try {
    const saved = await client
      .from("creator_profiles")
      .update({ timezone: parsed.data })
      .eq("user_id", userId)
      .select("user_id");
    if (saved.error) return dbFailed("timezone_save_failed", "update", saved.error.code);
    if (!saved.data?.length) return fail("missing_profile");
    return { ok: true, timezone: parsed.data };
  } catch (error) {
    return unexpected("timezone_save_failed", error);
  }
}

export interface CalendarSetup {
  onboarded: boolean;
  hasStrategy: boolean;
  timezone: string | null;
  postingCapacityPerWeek: number | null;
}

/** What the calendar page needs to choose its state. Never throws. */
export async function getCalendarSetup(
  client: ReadClient,
  userId: string,
): Promise<{ ok: true; setup: CalendarSetup } | { ok: false }> {
  try {
    const [profile, strategy, pillars] = await Promise.all([
      client
        .from("creator_profiles")
        .select("onboarding_status, timezone, posting_capacity_per_week")
        .eq("user_id", userId)
        .maybeSingle(),
      client.from("creator_strategies").select("id", { count: "exact", head: true }).eq("user_id", userId),
      client
        .from("content_pillars")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true),
    ]);
    const error = [profile, strategy, pillars].find((r) => r.error)?.error;
    if (error) {
      logEvent("error", "calendar_read_failed", { stage: "setup", db_code: error.code });
      return { ok: false };
    }
    return {
      ok: true,
      setup: {
        onboarded: profile.data?.onboarding_status === "completed",
        hasStrategy: (strategy.count ?? 0) > 0 && (pillars.count ?? 0) > 0,
        timezone: isValidTimezone(profile.data?.timezone) ? profile.data.timezone : null,
        postingCapacityPerWeek: profile.data?.posting_capacity_per_week ?? null,
      },
    };
  } catch (error) {
    logEvent("error", "calendar_read_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Reading a week
// ---------------------------------------------------------------------------

export interface CalendarItem extends StoredCalendarItem {
  /** Local date and time in the creator's zone. */
  date: string;
  time: string;
  /** The scheduled time is before now. */
  passed: boolean;
}

export type ListWeekResult =
  | { ok: true; items: CalendarItem[]; unscheduled: UnscheduledIdea[] }
  | { ok: false };

const ITEM_COLUMNS =
  "id, idea_id, title, platform, format, status, scheduled_for, pillar:content_pillars(name), idea:content_ideas(hook)";
const IDEA_COLUMNS = "id, topic, hook, format, platform, difficulty, pillar:content_pillars(name)";

/**
 * The creator's scheduled items in one week (Monday to Sunday in `tz`), in
 * time order, plus their saved ideas that aren't scheduled yet. Rows that no
 * longer validate are skipped and logged. An `unscheduledLimit` of 0 skips
 * the saved-ideas query. Never throws.
 */
export async function listWeek(
  client: ReadClient,
  userId: string,
  weekStartKey: string,
  tz: string,
  now: number = Date.now(),
  unscheduledLimit: number = UNSCHEDULED_LIMIT,
): Promise<ListWeekResult> {
  const range = weekRange(weekStartKey, tz);
  if (!range) return { ok: false };
  try {
    const [items, ideas] = await Promise.all([
      client
        .from("content_items")
        .select(ITEM_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "scheduled")
        .gte("scheduled_for", range.from)
        .lt("scheduled_for", range.to)
        .order("scheduled_for", { ascending: true }),
      // A limit of 0 means the caller only needs the week's items.
      unscheduledLimit > 0
        ? client
            .from("content_ideas")
            .select(IDEA_COLUMNS)
            .eq("user_id", userId)
            .eq("status", "saved")
            .order("created_at", { ascending: false })
            .limit(unscheduledLimit)
        : null,
    ]);
    const error = items.error ?? ideas?.error;
    if (error) {
      logEvent("error", "calendar_read_failed", { stage: "select", db_code: error.code });
      return { ok: false };
    }

    const calendarItems: CalendarItem[] = [];
    for (const row of items.data ?? []) {
      const { pillar, idea, ...rest } = row as typeof row & {
        pillar: { name: string } | null;
        idea: { hook: string | null } | null;
      };
      const parsed = parseWith(storedCalendarItem, { ...rest, pillar_name: pillar?.name ?? null, hook: idea?.hook ?? null });
      const date = parsed.ok ? localDateKey(parsed.data.scheduled_for, tz) : null;
      const time = parsed.ok ? localTimeKey(parsed.data.scheduled_for, tz) : null;
      if (!parsed.ok || !date || !time) {
        logEvent("warn", "calendar_read_skipped", { stage: "item" });
        continue;
      }
      calendarItems.push({ ...parsed.data, date, time, passed: Date.parse(parsed.data.scheduled_for) < now });
    }

    const unscheduled: UnscheduledIdea[] = [];
    for (const row of ideas?.data ?? []) {
      const { pillar, ...rest } = row as typeof row & { pillar: { name: string } | null };
      const parsed = parseWith(unscheduledIdea, { ...rest, pillar_name: pillar?.name ?? null });
      if (parsed.ok) unscheduled.push(parsed.data);
      else logEvent("warn", "calendar_read_skipped", { stage: "idea" });
    }

    return { ok: true, items: calendarItems, unscheduled };
  } catch (error) {
    logEvent("error", "calendar_read_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** The UTC instant for a local date/time, if it's inside the schedulable window. */
function instantInWindow(
  date: string,
  time: string,
  tz: string,
  now: number,
): { ok: true; instant: string } | CalendarFailure {
  const instant = localToInstant(date, time, tz);
  if (!instant) return fail("invalid_input");
  const ms = Date.parse(instant);
  if (ms < now - PAST_GRACE_MS) return fail("date_past");
  if (ms > now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) return fail("date_too_far");
  return { ok: true, instant };
}

const DB_ERRORS: Record<string, CalendarErrorCode> = {
  idea_not_found: "idea_not_found",
  idea_not_saved: "idea_not_saved",
  item_not_found: "not_found",
  duplicate_idea: "duplicate_idea",
  scheduled_for_out_of_range: "date_past",
  invalid_slots: "invalid_input",
};

function mapDbError(event: string, error: { code?: string; message?: string }): CalendarFailure {
  const known = error.message ? DB_ERRORS[error.message] : undefined;
  if (known) return fail(known);
  return dbFailed(event, "rpc", error.code);
}

/**
 * Schedules saved ideas on local dates and times in `tz`, atomically: one bad
 * slot schedules nothing. Each idea becomes a `scheduled` content item and
 * moves to `planned` (in `schedule_content_ideas`). Never throws.
 *
 * `userId` is not sent to the RPCs: the database takes the owner from the
 * session token, and RLS applies.
 */
export async function scheduleIdeas(
  client: CalendarClient,
  userId: string,
  slots: unknown,
  tz: string,
  now: number = Date.now(),
): Promise<{ ok: true; scheduled: number } | CalendarFailure> {
  const today = localDateKey(now, tz);
  if (!today) return fail("missing_timezone");

  const parsed = scheduleInputFor(today).safeParse(slots);
  if (!parsed.success) {
    const messages = new Set(parsed.error.issues.map((issue) => issue.message));
    for (const code of ["date_past", "date_too_far", "duplicate_idea"] as const) {
      if (messages.has(code)) return fail(code);
    }
    return fail("invalid_input");
  }

  const payload: { idea_id: string; scheduled_for: string }[] = [];
  for (const slot of parsed.data) {
    const checked = instantInWindow(slot.date, slot.time, tz, now);
    if (!checked.ok) return checked;
    payload.push({ idea_id: slot.idea_id, scheduled_for: checked.instant });
  }

  try {
    const result = await client.rpc("schedule_content_ideas", { p_slots: payload as unknown as Json });
    if (result.error) return mapDbError("calendar_schedule_failed", result.error);
    return { ok: true, scheduled: typeof result.data === "number" ? result.data : payload.length };
  } catch (error) {
    return unexpected("calendar_schedule_failed", error);
  }
}

const itemId = z.uuid();

/** Moves a scheduled item to another local date/time. Never throws. */
export async function rescheduleItem(
  client: ReadClient,
  userId: string,
  id: unknown,
  date: unknown,
  time: unknown,
  tz: string,
  now: number = Date.now(),
): Promise<{ ok: true } | CalendarFailure> {
  const parsedId = itemId.safeParse(id);
  if (!parsedId.success) return fail("not_found");
  const today = localDateKey(now, tz);
  if (!today) return fail("missing_timezone");
  if (typeof date !== "string" || typeof time !== "string") return fail("invalid_input");
  const checked = instantInWindow(date, time, tz, now);
  if (!checked.ok) return checked;

  try {
    const updated = await client
      .from("content_items")
      .update({ scheduled_for: checked.instant })
      .eq("id", parsedId.data)
      .eq("user_id", userId)
      .eq("status", "scheduled")
      .select("id");
    if (updated.error) return dbFailed("calendar_reschedule_failed", "update", updated.error.code);
    if (!updated.data?.length) return fail("not_found");
    return { ok: true };
  } catch (error) {
    return unexpected("calendar_reschedule_failed", error);
  }
}

/**
 * Takes a scheduled item off the calendar (`unschedule_content_item`): deleted
 * and its idea back to `saved`, or kept as a draft if it has Studio work.
 */
export async function unscheduleItem(
  client: CalendarClient,
  userId: string,
  id: unknown,
): Promise<{ ok: true } | CalendarFailure> {
  const parsedId = itemId.safeParse(id);
  if (!parsedId.success) return fail("not_found");
  try {
    const result = await client.rpc("unschedule_content_item", { p_item_id: parsedId.data });
    if (result.error) return mapDbError("calendar_unschedule_failed", result.error);
    return { ok: true };
  } catch (error) {
    return unexpected("calendar_unschedule_failed", error);
  }
}
