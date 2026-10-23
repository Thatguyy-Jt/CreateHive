"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { INSIGHT_ERRORS } from "@/lib/schemas/insights";
import { getTimezone } from "@/lib/services/calendar";
import { setInsightStatus, updateCreatorInsights } from "@/lib/services/insights";
import { createUserClient } from "@/lib/supabase/server";

// Server actions are public POST endpoints: each one authenticates itself and
// takes the creator's id only from Clerk's session, never from the browser.

function userClient(event: string) {
  try {
    return createUserClient();
  } catch (error) {
    logEvent("error", event, { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

function revalidateInsights() {
  revalidatePath("/app/insights");
  revalidatePath("/app");
}

export type UpdateInsightsActionResult =
  | { ok: true; count: number; notes: string[] }
  | { ok: false; message: string; retryable: boolean; upgrade?: boolean };

/** Runs the Learning Agent and replaces the creator's active insights. */
export async function updateInsightsAction(): Promise<UpdateInsightsActionResult> {
  const { userId } = await auth.protect();

  const client = userClient("creator_insights_failed");
  if (!client) return { ok: false, ...INSIGHT_ERRORS.persistence_error };
  // Only for weekday and date labels; a missing timezone leaves them out.
  const timezone = await getTimezone(client, userId);

  const result = await updateCreatorInsights(client, userId, timezone.ok ? timezone.timezone : null, {
    run: runStructured,
  });
  if (!result.ok) {
    return { ok: false, message: result.message, retryable: result.retryable, upgrade: result.code === "upgrade_required" };
  }

  revalidateInsights();
  return { ok: true, count: result.count, notes: result.notes };
}

const statusInput = z.object({ id: z.uuid(), status: z.enum(["dismissed", "active"]) });

export type InsightStatusActionResult = { ok: true } | { ok: false; message: string };

/** Dismisses an insight, or restores one from the latest update (Undo). No AI. */
export async function setInsightStatusAction(id: unknown, status: unknown): Promise<InsightStatusActionResult> {
  const { userId } = await auth.protect();

  const parsed = statusInput.safeParse({ id, status });
  if (!parsed.success) return { ok: false, message: INSIGHT_ERRORS.not_found.message };

  const client = userClient("insight_status_failed");
  if (!client) return { ok: false, message: INSIGHT_ERRORS.save_failed.message };

  const result = await setInsightStatus(client, userId, parsed.data.id, parsed.data.status);
  if (!result.ok) return { ok: false, message: result.message };

  revalidateInsights();
  return { ok: true };
}
