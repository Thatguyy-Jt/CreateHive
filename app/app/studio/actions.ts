"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { STUDIO_ERRORS } from "@/lib/schemas/studio";
import { CALENDAR_ERRORS, getTimezone } from "@/lib/services/calendar";
import {
  discardStudioItem,
  generateContentPackage,
  regenerateSection,
  restoreVersion,
  savePackageSection,
  scheduleStudioItem,
  startStudioItem,
} from "@/lib/services/studio";
import { createUserClient } from "@/lib/supabase/server";

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

const idInput = z.uuid();

export interface StartStudioState {
  status: "idle" | "error";
  message: string | null;
}

/** Opens Studio for a saved idea, creating its draft if needed, then goes to the item. */
export async function startStudioItemAction(_previous: StartStudioState, formData: FormData): Promise<StartStudioState> {
  // Public POST endpoint: identity only from Clerk's session.
  const { userId } = await auth.protect();

  const ideaId = idInput.safeParse(field(formData, "idea_id"));
  if (!ideaId.success) return { status: "error", message: STUDIO_ERRORS.idea_not_found.message };

  const client = userClient("studio_start_failed");
  if (!client) return { status: "error", message: STUDIO_ERRORS.db_error.message };

  const result = await startStudioItem(client, userId, ideaId.data);
  if (!result.ok) return { status: "error", message: result.message };

  // The idea moved to `in_production`: saved lists and the dashboard change.
  revalidatePath("/app");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/calendar");
  revalidatePath("/app/studio");
  // Outside any try: `redirect` works by throwing.
  redirect(`/app/studio/${result.itemId}`);
}

export interface GeneratePackageState {
  status: "idle" | "ok" | "error";
  message: string | null;
  retryable: boolean;
  /** A Free plan allowance was used up: show Upgrade to Pro. */
  upgrade?: boolean;
  /** Changes on every result, so the control toasts once. */
  submission: number;
  versionNo?: number;
}

/** Creates (or regenerates) the package for one Studio item. Success re-renders the page. */
export async function generatePackageAction(
  previous: GeneratePackageState,
  formData: FormData,
): Promise<GeneratePackageState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const error = (message: string, retryable: boolean): GeneratePackageState => ({
    status: "error",
    message,
    retryable,
    submission,
  });

  const itemId = idInput.safeParse(field(formData, "item_id"));
  if (!itemId.success) return error(STUDIO_ERRORS.not_found.message, false);

  const client = userClient("content_package_failed");
  if (!client) return error(STUDIO_ERRORS.persistence_error.message, true);

  const result = await generateContentPackage(client, userId, itemId.data, { run: runStructured });
  if (!result.ok) return { ...error(result.message, result.retryable), upgrade: result.code === "upgrade_required" };

  revalidatePath(`/app/studio/${itemId.data}`);
  revalidatePath("/app/studio");
  return { status: "ok", message: null, retryable: false, submission, versionNo: result.versionNo };
}

export interface ScheduleStudioState {
  status: "idle" | "ok" | "error";
  message: string | null;
  submission: number;
  /** On success: the local date scheduled, for the confirmation. */
  date?: string;
}

/** Puts a Studio draft on the calendar at a local date and time in the creator's saved timezone. */
export async function scheduleStudioItemAction(
  previous: ScheduleStudioState,
  formData: FormData,
): Promise<ScheduleStudioState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const error = (message: string): ScheduleStudioState => ({ status: "error", message, submission });

  const itemId = idInput.safeParse(field(formData, "item_id"));
  if (!itemId.success) return error(STUDIO_ERRORS.not_found.message);

  const client = userClient("studio_schedule_failed");
  if (!client) return error(CALENDAR_ERRORS.db_error);

  // The timezone comes from the database, never from the browser.
  const tz = await getTimezone(client, userId);
  if (!tz.ok) return error(tz.message);
  if (!tz.timezone) return error(CALENDAR_ERRORS.missing_timezone);

  const date = field(formData, "date");
  const result = await scheduleStudioItem(client, userId, itemId.data, date, field(formData, "time"), tz.timezone);
  if (!result.ok) return error(result.message);

  revalidatePath("/app");
  revalidatePath("/app/calendar");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/studio");
  revalidatePath(`/app/studio/${itemId.data}`);
  return { status: "ok", message: null, submission, date };
}

export type SaveSectionResult = { ok: true; versionNo: number } | { ok: false; message: string };

/**
 * Saves the creator's edit of one section as a new version. Untrusted input:
 * the service validates the section value and merges it server-side.
 */
export async function savePackageSectionAction(itemId: unknown, input: unknown): Promise<SaveSectionResult> {
  const { userId } = await auth.protect();

  const id = idInput.safeParse(itemId);
  if (!id.success) return { ok: false, message: STUDIO_ERRORS.not_found.message };

  const client = userClient("studio_save_failed");
  if (!client) return { ok: false, message: STUDIO_ERRORS.persistence_error.message };

  const result = await savePackageSection(client, userId, id.data, input);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/app/studio/${id.data}`);
  return { ok: true, versionNo: result.versionNo };
}

const positiveInt = z.coerce.number().int().positive();

export interface VersionActionState {
  status: "idle" | "error";
  message: string | null;
}

/** Restores a past version as the new latest one, then shows the latest. */
export async function restoreVersionAction(_previous: VersionActionState, formData: FormData): Promise<VersionActionState> {
  const { userId } = await auth.protect();

  const itemId = idInput.safeParse(field(formData, "item_id"));
  if (!itemId.success) return { status: "error", message: STUDIO_ERRORS.not_found.message };
  const versionNo = positiveInt.safeParse(field(formData, "version_no"));
  const baseVersion = positiveInt.safeParse(field(formData, "base_version"));
  if (!versionNo.success || !baseVersion.success) {
    return { status: "error", message: STUDIO_ERRORS.invalid_input.message };
  }

  const client = userClient("studio_restore_failed");
  if (!client) return { status: "error", message: STUDIO_ERRORS.persistence_error.message };

  const result = await restoreVersion(client, userId, itemId.data, {
    versionNo: versionNo.data,
    baseVersion: baseVersion.data,
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/app/studio/${itemId.data}`);
  // Outside any try: `redirect` works by throwing.
  redirect(`/app/studio/${itemId.data}`);
}

/** Regenerates one section of the latest package. Success re-renders the page. */
export async function regenerateSectionAction(
  previous: GeneratePackageState,
  formData: FormData,
): Promise<GeneratePackageState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const error = (message: string, retryable: boolean): GeneratePackageState => ({
    status: "error",
    message,
    retryable,
    submission,
  });

  const itemId = idInput.safeParse(field(formData, "item_id"));
  if (!itemId.success) return error(STUDIO_ERRORS.not_found.message, false);
  const baseVersion = positiveInt.safeParse(field(formData, "base_version"));
  if (!baseVersion.success) return error(STUDIO_ERRORS.invalid_input.message, false);

  const client = userClient("content_section_failed");
  if (!client) return error(STUDIO_ERRORS.persistence_error.message, true);

  const result = await regenerateSection(
    client,
    userId,
    itemId.data,
    { section: field(formData, "section"), baseVersion: baseVersion.data, instruction: field(formData, "instruction") },
    { run: runStructured },
  );
  if (!result.ok) return { ...error(result.message, result.retryable), upgrade: result.code === "upgrade_required" };

  revalidatePath(`/app/studio/${itemId.data}`);
  return { status: "ok", message: null, retryable: false, submission, versionNo: result.versionNo };
}

/** Deletes a Studio draft and its versions, returns its idea to Saved, then goes to the Studio list. */
export async function discardStudioItemAction(_previous: VersionActionState, formData: FormData): Promise<VersionActionState> {
  const { userId } = await auth.protect();

  const itemId = idInput.safeParse(field(formData, "item_id"));
  if (!itemId.success) return { status: "error", message: STUDIO_ERRORS.not_found.message };

  const client = userClient("studio_discard_failed");
  if (!client) return { status: "error", message: STUDIO_ERRORS.db_error.message };

  const result = await discardStudioItem(client, userId, itemId.data);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/app");
  revalidatePath("/app/opportunities");
  revalidatePath("/app/calendar");
  revalidatePath("/app/studio", "layout");
  revalidatePath("/app/analytics");
  redirect("/app/studio");
}
