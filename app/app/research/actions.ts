"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logEvent } from "@/lib/observability/log";
import { manualSignalInput } from "@/lib/schemas/research";
import { addManualSignal, deleteSignal, SIGNAL_ERRORS } from "@/lib/services/research-signals";
import { refreshYouTubeSignals, YOUTUBE_ERRORS } from "@/lib/services/youtube-refresh";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

type FieldName = "type" | "text" | "label" | "source_url";

export interface AddSignalState {
  status: "idle" | "ok" | "error";
  message: string | null;
  fieldErrors: Partial<Record<FieldName, string>>;
  /** What the creator submitted, so a failed attempt keeps their text. */
  values: Record<FieldName, string>;
  /** Changes on every result, so the form remounts with fresh defaults. */
  submission: number;
}

const field = (formData: FormData, name: FieldName) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function revalidate() {
  revalidatePath("/app/research");
  revalidatePath("/app/opportunities");
}

function userClient(event: string) {
  try {
    return createUserClient();
  } catch (error) {
    logEvent("error", event, { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

/** Adds a pasted signal for the signed-in creator. */
export async function addSignalAction(previous: AddSignalState, formData: FormData): Promise<AddSignalState> {
  // Public POST endpoint: identity only from Clerk's session.
  const { userId } = await auth.protect();

  const values: AddSignalState["values"] = {
    type: field(formData, "type"),
    text: field(formData, "text"),
    label: field(formData, "label"),
    source_url: field(formData, "source_url"),
  };
  const submission = previous.submission + 1;
  const error = (message: string | null, fieldErrors: AddSignalState["fieldErrors"] = {}): AddSignalState => ({
    status: "error",
    message,
    fieldErrors,
    values,
    submission,
  });

  const input = manualSignalInput.safeParse(values);
  if (!input.success) {
    const fieldErrors: AddSignalState["fieldErrors"] = {};
    for (const issue of input.error.issues) {
      const name = issue.path[0] as FieldName;
      fieldErrors[name] ??= issue.message;
    }
    return error("Check the highlighted fields.", fieldErrors);
  }

  const client = userClient("signal_save_failed");
  if (!client) return error(SIGNAL_ERRORS.db_error);

  const result = await addManualSignal(client, userId, input.data);
  if (!result.ok) return error(result.message);

  revalidate();
  return {
    status: "ok",
    message: null,
    fieldErrors: {},
    values: { type: values.type, text: "", label: "", source_url: "" },
    submission,
  };
}

export interface DeleteSignalState {
  status: "idle" | "error";
  message: string | null;
}

const deleteInput = z.object({ id: z.uuid() });

/** Deletes one of the signed-in creator's signals. */
export async function deleteSignalAction(_previous: DeleteSignalState, formData: FormData): Promise<DeleteSignalState> {
  const { userId } = await auth.protect();

  const input = deleteInput.safeParse({ id: formData.get("id") });
  if (!input.success) return { status: "error", message: SIGNAL_ERRORS.not_found };

  const client = userClient("signal_delete_failed");
  if (!client) return { status: "error", message: SIGNAL_ERRORS.db_error };

  const result = await deleteSignal(client, userId, input.data.id);
  if (!result.ok) return { status: "error", message: result.message };

  revalidate();
  return { status: "idle", message: null };
}

export interface RefreshYouTubeState {
  status: "idle" | "ok" | "error";
  message: string | null;
  added: number;
}

/** Fetches recent popular YouTube videos for the signed-in creator's niche. Uses no AI generations. */
export async function refreshYouTubeAction(): Promise<RefreshYouTubeState> {
  const { userId } = await auth.protect();

  const client = userClient("youtube_refresh_failed");
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    logEvent("error", "youtube_refresh_failed", { stage: "admin_client", name: error instanceof Error ? error.name : typeof error });
  }
  if (!client || !admin) return { status: "error", message: YOUTUBE_ERRORS.db_error, added: 0 };

  const result = await refreshYouTubeSignals(client, admin, userId);
  if (!result.ok) return { status: "error", message: result.message, added: 0 };

  revalidate();
  return { status: "ok", message: null, added: result.added };
}
