"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { ideaStatus } from "@/lib/schemas/enums";
import {
  generateContentOpportunities,
  OPPORTUNITY_ERRORS,
  STATUS_ERRORS,
  updateOpportunityStatus,
} from "@/lib/services/opportunities";
import { createUserClient } from "@/lib/supabase/server";

export interface GenerateOpportunitiesState {
  status: "idle" | "ok" | "error";
  message: string | null;
  retryable: boolean;
  created: number;
}

/** Generates a batch of ideas for the signed-in creator. Success re-renders the list; the client shows a toast. */
export async function generateOpportunitiesAction(): Promise<GenerateOpportunitiesState> {
  // Public POST endpoint: identity only from Clerk's session.
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "opportunity_generation_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    const { message, retryable } = OPPORTUNITY_ERRORS.persistence_error;
    return { status: "error", message, retryable, created: 0 };
  }

  const result = await generateContentOpportunities(client, userId, { run: runStructured });
  if (!result.ok) return { status: "error", message: result.message, retryable: result.retryable, created: 0 };

  revalidatePath("/app/opportunities");
  // New ideas change the dashboard's recommendation.
  revalidatePath("/app");
  return { status: "ok", message: null, retryable: false, created: result.created };
}

export interface StatusActionState {
  status: "idle" | "error";
  message: string | null;
}

const statusInput = z.object({ id: z.uuid(), status: ideaStatus });

/** Save / dismiss / unsave / restore one idea. The transition is allow-listed in the service. */
export async function updateOpportunityStatusAction(
  _previous: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const { userId } = await auth.protect();

  const input = statusInput.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!input.success) return { status: "error", message: STATUS_ERRORS.invalid_transition };

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "opportunity_status_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { status: "error", message: STATUS_ERRORS.db_error };
  }

  const result = await updateOpportunityStatus(client, userId, input.data.id, input.data.status);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/app/opportunities");
  // Saved ideas are listed on the calendar and drive the dashboard too.
  revalidatePath("/app/calendar");
  revalidatePath("/app");
  return { status: "idle", message: null };
}
