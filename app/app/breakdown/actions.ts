"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { BREAKDOWN_ERRORS, FORM_FIELDS, type BreakdownFormField, type BreakdownFormValues } from "@/lib/schemas/breakdown";
import {
  analyzeReferenceVideo,
  deleteBreakdown,
  rerunBreakdown,
  saveBreakdownAsIdea,
} from "@/lib/services/video-breakdown";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

const uuid = z.uuid();

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function clients(event: string) {
  try {
    return { client: createUserClient(), admin: createAdminClient() };
  } catch (error) {
    logEvent("error", event, { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

export interface BreakdownFormState {
  status: "idle" | "error";
  message: string | null;
  retryable: boolean;
  /** Pro only, or the plan's allowance is used up: show Upgrade to Pro. */
  upgrade?: boolean;
  fieldErrors: Partial<Record<BreakdownFormField, string>>;
  /** What the creator submitted, so a failed attempt keeps their text. */
  values: BreakdownFormValues;
  /** Changes on every result, so the form remounts with fresh defaults. */
  submission: number;
}

/** Breaks down a pasted video for the signed-in creator. Success opens the breakdown. */
export async function createBreakdownAction(previous: BreakdownFormState, formData: FormData): Promise<BreakdownFormState> {
  // Public POST endpoint: identity only from Clerk's session.
  const { userId } = await auth.protect();
  const values = Object.fromEntries(FORM_FIELDS.map((name) => [name, field(formData, name)])) as BreakdownFormValues;
  const submission = previous.submission + 1;

  const db = clients("video_breakdown_failed");
  if (!db) {
    return { status: "error", ...BREAKDOWN_ERRORS.persistence_error, fieldErrors: {}, values, submission };
  }
  const result = await analyzeReferenceVideo(db.client, db.admin, userId, values, {}, { run: runStructured });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      retryable: result.retryable,
      upgrade: result.code === "upgrade_required",
      fieldErrors: result.fieldErrors ?? {},
      values,
      submission,
    };
  }
  revalidatePath("/app/breakdown");
  redirect(`/app/breakdown/${result.breakdownId}`);
}

export interface BreakdownItemState {
  status: "idle" | "ok" | "error";
  message: string | null;
  upgrade?: boolean;
  /** The saved idea, after Save as idea. */
  ideaId?: string;
  submission: number;
}

/** Saves the breakdown's version as a saved idea (idempotent). */
export async function saveBreakdownIdeaAction(previous: BreakdownItemState, formData: FormData): Promise<BreakdownItemState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const id = uuid.safeParse(field(formData, "breakdown_id"));
  if (!id.success) return { status: "error", message: BREAKDOWN_ERRORS.not_found.message, submission };

  const db = clients("video_breakdown_idea_failed");
  if (!db) return { status: "error", message: BREAKDOWN_ERRORS.idea_failed.message, submission };
  const result = await saveBreakdownAsIdea(db.client, userId, id.data);
  if (!result.ok) return { status: "error", message: result.message, submission };

  revalidatePath(`/app/breakdown/${id.data}`);
  revalidatePath("/app/opportunities");
  return { status: "ok", message: null, ideaId: result.ideaId, submission };
}

/** Breaks the same video down again with the stored input. Always counts toward the allowance. */
export async function rerunBreakdownAction(previous: BreakdownItemState, formData: FormData): Promise<BreakdownItemState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const id = uuid.safeParse(field(formData, "breakdown_id"));
  if (!id.success) return { status: "error", message: BREAKDOWN_ERRORS.not_found.message, submission };

  const db = clients("video_breakdown_failed");
  if (!db) return { status: "error", message: BREAKDOWN_ERRORS.persistence_error.message, submission };
  const result = await rerunBreakdown(db.client, db.admin, userId, id.data, { run: runStructured });
  if (!result.ok) {
    return { status: "error", message: result.message, upgrade: result.code === "upgrade_required", submission };
  }
  revalidatePath("/app/breakdown");
  redirect(`/app/breakdown/${result.breakdownId}`);
}

/** Deletes one of the signed-in creator's breakdowns, then returns to the list. */
export async function deleteBreakdownAction(previous: BreakdownItemState, formData: FormData): Promise<BreakdownItemState> {
  const { userId } = await auth.protect();
  const submission = previous.submission + 1;
  const id = uuid.safeParse(field(formData, "breakdown_id"));
  if (!id.success) return { status: "error", message: BREAKDOWN_ERRORS.not_found.message, submission };

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "video_breakdown_delete_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return { status: "error", message: BREAKDOWN_ERRORS.persistence_error.message, submission };
  }
  const result = await deleteBreakdown(client, userId, id.data);
  if (!result.ok) return { status: "error", message: result.message, submission };

  revalidatePath("/app/breakdown");
  redirect("/app/breakdown?deleted=1");
}
