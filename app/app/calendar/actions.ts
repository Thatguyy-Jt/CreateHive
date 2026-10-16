"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { dateKey, MAX_SLOTS_PER_REQUEST, type ProposedSlot } from "@/lib/schemas/calendar";
import {
  CALENDAR_ERRORS,
  getTimezone,
  rescheduleItem,
  saveTimezone,
  scheduleIdeas,
  unscheduleItem,
  type CalendarErrorCode,
} from "@/lib/services/calendar";
import { generateWeeklyPlan, WEEKLY_PLAN_ERRORS } from "@/lib/services/weekly-plan";
import { createUserClient } from "@/lib/supabase/server";

export interface CalendarActionState {
  status: "idle" | "ok" | "error";
  message: string | null;
  /** Changes on every result, so a form can remount or toast once. */
  submission: number;
  /** On success: the local date scheduled, for the confirmation. */
  date?: string;
}

function revalidate() {
  // The dashboard's recommendation reads the calendar and saved ideas.
  revalidatePath("/app");
  revalidatePath("/app/calendar");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/settings");
  // Studio lists scheduled items and drafts kept after unscheduling.
  revalidatePath("/app/studio", "layout");
  revalidatePath("/app/analytics");
}

function userClient(event: string) {
  try {
    return createUserClient();
  } catch (error) {
    logEvent("error", event, { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** The creator's timezone from the database, never from the browser. */
async function timezoneFor(
  client: NonNullable<ReturnType<typeof userClient>>,
  userId: string,
): Promise<{ ok: true; tz: string } | { ok: false; code: CalendarErrorCode }> {
  const result = await getTimezone(client, userId);
  if (!result.ok) return { ok: false, code: result.code };
  if (!result.timezone) return { ok: false, code: "missing_timezone" };
  return { ok: true, tz: result.timezone };
}

/** Saves the signed-in creator's timezone (calendar confirm card and Settings). */
export async function saveTimezoneAction(previous: CalendarActionState, formData: FormData): Promise<CalendarActionState> {
  // Public POST endpoint: identity only from Clerk's session.
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;

  const client = userClient("timezone_save_failed");
  if (!client) return { status: "error", message: CALENDAR_ERRORS.db_error, submission };

  const result = await saveTimezone(client, userId, field(formData, "timezone"));
  if (!result.ok) return { status: "error", message: result.message, submission };

  revalidate();
  return { status: "ok", message: null, submission };
}

/** Schedules one saved idea on a local date and time. */
export async function scheduleIdeaAction(previous: CalendarActionState, formData: FormData): Promise<CalendarActionState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const error = (code: CalendarErrorCode): CalendarActionState => ({
    status: "error",
    message: CALENDAR_ERRORS[code],
    submission,
  });

  const client = userClient("calendar_schedule_failed");
  if (!client) return error("db_error");
  const tz = await timezoneFor(client, userId);
  if (!tz.ok) return error(tz.code);

  const slot = { idea_id: field(formData, "idea_id"), date: field(formData, "date"), time: field(formData, "time") };
  const result = await scheduleIdeas(client, userId, [slot], tz.tz);
  if (!result.ok) return { status: "error", message: result.message, submission };

  revalidate();
  return { status: "ok", message: null, submission, date: slot.date };
}

/** Moves one scheduled item to another local date and time. */
export async function rescheduleItemAction(previous: CalendarActionState, formData: FormData): Promise<CalendarActionState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;

  const client = userClient("calendar_reschedule_failed");
  if (!client) return { status: "error", message: CALENDAR_ERRORS.db_error, submission };
  const tz = await timezoneFor(client, userId);
  if (!tz.ok) return { status: "error", message: CALENDAR_ERRORS[tz.code], submission };

  const result = await rescheduleItem(
    client,
    userId,
    field(formData, "id"),
    field(formData, "date"),
    field(formData, "time"),
    tz.tz,
  );
  if (!result.ok) return { status: "error", message: result.message, submission };

  revalidate();
  return { status: "ok", message: null, submission, date: field(formData, "date") };
}

/** Takes one scheduled item off the calendar. */
export async function unscheduleItemAction(previous: CalendarActionState, formData: FormData): Promise<CalendarActionState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;

  const client = userClient("calendar_unschedule_failed");
  if (!client) return { status: "error", message: CALENDAR_ERRORS.db_error, submission };

  const result = await unscheduleItem(client, userId, field(formData, "id"));
  if (!result.ok) return { status: "error", message: result.message, submission };

  revalidate();
  return { status: "ok", message: null, submission };
}

export type WeeklyPlanActionResult =
  | { ok: true; slots: ProposedSlot[]; note: string | null }
  | { ok: false; message: string; retryable: boolean };

/** Suggests a week from the creator's saved ideas. Stores nothing, so it revalidates nothing. */
export async function generateWeeklyPlanAction(weekStart: unknown): Promise<WeeklyPlanActionResult> {
  const { userId } = await auth.protect();

  const week = dateKey.safeParse(weekStart);
  if (!week.success) return { ok: false, ...WEEKLY_PLAN_ERRORS.invalid_week };

  const client = userClient("weekly_plan_failed");
  if (!client) return { ok: false, ...WEEKLY_PLAN_ERRORS.persistence_error };

  const result = await generateWeeklyPlan(client, userId, { weekStart: week.data }, { run: runStructured });
  if (!result.ok) return { ok: false, message: result.message, retryable: result.retryable };
  return { ok: true, slots: result.slots, note: result.note };
}

export type AcceptPlanActionResult = { ok: true; scheduled: number } | { ok: false; message: string };

// Untrusted: only these fields are read, and the service re-validates each slot
// (ownership, `saved` status, dates) exactly as for manual scheduling.
const acceptInput = z
  .array(z.object({ idea_id: z.string(), date: z.string(), time: z.string() }))
  .min(1)
  .max(MAX_SLOTS_PER_REQUEST);

/** Schedules the slots the creator kept from a suggested week, atomically. */
export async function acceptPlanAction(slots: unknown): Promise<AcceptPlanActionResult> {
  const { userId } = await auth.protect();

  const input = acceptInput.safeParse(slots);
  if (!input.success) return { ok: false, message: CALENDAR_ERRORS.invalid_input };

  const client = userClient("calendar_schedule_failed");
  if (!client) return { ok: false, message: CALENDAR_ERRORS.db_error };
  const tz = await timezoneFor(client, userId);
  if (!tz.ok) return { ok: false, message: CALENDAR_ERRORS[tz.code] };

  const result = await scheduleIdeas(client, userId, input.data, tz.tz);
  if (!result.ok) return { ok: false, message: result.message };

  revalidate();
  return { ok: true, scheduled: result.scheduled };
}
