"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { ANALYTICS_ERRORS, type AnalyticsErrorCode } from "@/lib/schemas/analytics";
import { DIAGNOSIS_ERRORS } from "@/lib/schemas/diagnosis";
import {
  addResults,
  deletePost,
  deleteResults,
  logPastPost,
  publishStudioItem,
  updatePostDetails,
  type AnalyticsFailure,
} from "@/lib/services/analytics";
import { getTimezone } from "@/lib/services/calendar";
import { analyzeContentPerformance, saveExperimentAsIdea } from "@/lib/services/diagnosis";
import { createUserClient } from "@/lib/supabase/server";

// Server actions are public POST endpoints: each one authenticates itself and
// takes the creator's id only from Clerk's session, never from the form.

export interface AnalyticsFormState {
  status: "idle" | "ok" | "error";
  message: string | null;
  fieldErrors: Record<string, string>;
  /** Changes on every result, so a form can remount or toast once. */
  submission: number;
  /** The submitted text, so a form that failed keeps what the creator typed. */
  values: Record<string, string>;
}

/** Text fields any analytics form may send. Nothing else is echoed back. */
const FORM_FIELDS = [
  "title",
  "platform",
  "format",
  "date",
  "time",
  "published_url",
  "hook_used",
  "duration_seconds",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "follower_delta",
  "avg_view_duration_seconds",
  "avg_percent_viewed",
] as const;

function readForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of FORM_FIELDS) {
    const value = formData.get(name);
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

const uuid = z.uuid();

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function userClient(event: string) {
  try {
    return createUserClient();
  } catch (error) {
    logEvent("error", event, { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

function failed(
  previous: AnalyticsFormState,
  values: Record<string, string>,
  failure: Pick<AnalyticsFailure, "message" | "fieldErrors">,
): AnalyticsFormState {
  return {
    status: "error",
    message: failure.message,
    fieldErrors: failure.fieldErrors,
    submission: previous.submission + 1,
    values,
  };
}

const failedWith = (previous: AnalyticsFormState, values: Record<string, string>, code: AnalyticsErrorCode) =>
  failed(previous, values, { message: ANALYTICS_ERRORS[code], fieldErrors: {} });

const ok = (previous: AnalyticsFormState): AnalyticsFormState => ({
  status: "ok",
  message: null,
  fieldErrors: {},
  submission: previous.submission + 1,
  values: {},
});

/** The creator's timezone from the database, never from the browser. */
async function timezoneFor(
  client: NonNullable<ReturnType<typeof userClient>>,
  userId: string,
): Promise<{ ok: true; tz: string } | { ok: false; code: AnalyticsErrorCode }> {
  const result = await getTimezone(client, userId);
  if (!result.ok) return { ok: false, code: "db_error" };
  if (!result.timezone) return { ok: false, code: "missing_timezone" };
  return { ok: true, tz: result.timezone };
}

function revalidatePosts(itemId?: string | null) {
  // The dashboard's Performance card, the list and the post page read posts.
  revalidatePath("/app");
  revalidatePath("/app/analytics");
  if (itemId) revalidatePath(`/app/analytics/${itemId}`);
}

/** Marks a Studio item as published, then shows its post page. */
export async function publishStudioItemAction(
  previous: AnalyticsFormState,
  formData: FormData,
): Promise<AnalyticsFormState> {
  const { userId } = await auth.protect();
  const values = readForm(formData);
  const itemId = field(formData, "item_id");

  const client = userClient("analytics_write_failed");
  if (!client) return failedWith(previous, values, "db_error");
  const tz = await timezoneFor(client, userId);
  if (!tz.ok) return failedWith(previous, values, tz.code);

  const result = await publishStudioItem(client, userId, itemId, values, tz.tz);
  if (!result.ok) return failed(previous, values, result);

  // The item left the calendar and Studio's list; its idea became `used`.
  revalidatePosts(itemId);
  revalidatePath("/app/calendar");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/studio", "layout");
  // Outside any try: `redirect` works by throwing.
  redirect(`/app/analytics/${itemId}`);
}

/** Logs a post made outside the app, then shows its post page. */
export async function logPastPostAction(previous: AnalyticsFormState, formData: FormData): Promise<AnalyticsFormState> {
  const { userId } = await auth.protect();
  const values = readForm(formData);

  const client = userClient("analytics_write_failed");
  if (!client) return failedWith(previous, values, "db_error");
  const tz = await timezoneFor(client, userId);
  if (!tz.ok) return failedWith(previous, values, tz.code);

  const result = await logPastPost(client, userId, values, tz.tz);
  if (!result.ok) return failed(previous, values, result);

  revalidatePosts(result.itemId);
  redirect(`/app/analytics/${result.itemId}`);
}

/** Saves a post's edited details. */
export async function updatePostDetailsAction(
  previous: AnalyticsFormState,
  formData: FormData,
): Promise<AnalyticsFormState> {
  const { userId } = await auth.protect();
  const values = readForm(formData);
  const itemId = field(formData, "item_id");

  const client = userClient("analytics_write_failed");
  if (!client) return failedWith(previous, values, "db_error");
  const tz = await timezoneFor(client, userId);
  if (!tz.ok) return failedWith(previous, values, tz.code);

  const result = await updatePostDetails(client, userId, itemId, values, tz.tz);
  if (!result.ok) return failed(previous, values, result);

  revalidatePosts(itemId);
  revalidatePath(`/app/studio/${itemId}`);
  return ok(previous);
}

/** Deletes a post and its results, then goes back to the list. */
export async function deletePostAction(previous: AnalyticsFormState, formData: FormData): Promise<AnalyticsFormState> {
  const { userId } = await auth.protect();

  const client = userClient("analytics_write_failed");
  if (!client) return failedWith(previous, {}, "db_error");

  const result = await deletePost(client, userId, field(formData, "item_id"));
  if (!result.ok) return failed(previous, {}, result);

  revalidatePosts();
  redirect("/app/analytics");
}

/** Adds one results check-in to a post. */
export async function addResultsAction(previous: AnalyticsFormState, formData: FormData): Promise<AnalyticsFormState> {
  const { userId } = await auth.protect();
  const values = readForm(formData);
  const itemId = field(formData, "item_id");

  const client = userClient("analytics_write_failed");
  if (!client) return failedWith(previous, values, "db_error");

  const result = await addResults(client, userId, itemId, values);
  if (!result.ok) return failed(previous, values, result);

  revalidatePosts(itemId);
  return ok(previous);
}

/** Deletes one results check-in. */
export async function deleteResultsAction(previous: AnalyticsFormState, formData: FormData): Promise<AnalyticsFormState> {
  const { userId } = await auth.protect();

  const client = userClient("analytics_write_failed");
  if (!client) return failedWith(previous, {}, "db_error");

  const result = await deleteResults(client, userId, field(formData, "snapshot_id"));
  if (!result.ok) return failed(previous, {}, result);

  revalidatePosts(result.itemId);
  return ok(previous);
}

export interface DiagnosisActionState {
  status: "idle" | "ok" | "error";
  message: string | null;
  retryable: boolean;
  /** Changes on every result, so a control toasts or focuses once. */
  submission: number;
}

/** Diagnoses one published post with AI and stores the result. Success re-renders the page. */
export async function diagnosePostAction(
  previous: DiagnosisActionState,
  formData: FormData,
): Promise<DiagnosisActionState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const error = (message: string, retryable: boolean): DiagnosisActionState => ({
    status: "error",
    message,
    retryable,
    submission,
  });

  const itemId = uuid.safeParse(field(formData, "item_id"));
  if (!itemId.success) return error(DIAGNOSIS_ERRORS.not_found.message, false);

  const client = userClient("content_diagnosis_failed");
  if (!client) return error(DIAGNOSIS_ERRORS.persistence_error.message, true);
  // Only for the "posted on" label; a missing timezone leaves it out.
  const timezone = await getTimezone(client, userId);

  const result = await analyzeContentPerformance(
    client,
    userId,
    itemId.data,
    timezone.ok ? timezone.timezone : null,
    { run: runStructured },
  );
  if (!result.ok) return error(result.message, result.retryable);

  revalidatePath(`/app/analytics/${itemId.data}`);
  return { status: "ok", message: null, retryable: false, submission };
}

export interface SaveExperimentState {
  status: "idle" | "ok" | "error";
  message: string | null;
  submission: number;
}

/** Saves a diagnosis's next experiment as a saved idea (idempotent). */
export async function saveExperimentAction(
  previous: SaveExperimentState,
  formData: FormData,
): Promise<SaveExperimentState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;

  const diagnosisId = uuid.safeParse(field(formData, "diagnosis_id"));
  const itemId = uuid.safeParse(field(formData, "item_id"));
  if (!diagnosisId.success || !itemId.success) {
    return { status: "error", message: DIAGNOSIS_ERRORS.not_found.message, submission };
  }

  const client = userClient("diagnosis_idea_failed");
  if (!client) return { status: "error", message: DIAGNOSIS_ERRORS.idea_failed.message, submission };

  const result = await saveExperimentAsIdea(client, userId, diagnosisId.data);
  if (!result.ok) return { status: "error", message: result.message, submission };

  // The idea joins Saved; the dashboard recommendation reads saved ideas.
  revalidatePath("/app");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/calendar");
  revalidatePath(`/app/analytics/${itemId.data}`);
  return { status: "ok", message: null, submission };
}
