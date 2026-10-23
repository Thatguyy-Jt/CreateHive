"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { generateCreatorStrategy, STRATEGY_ERRORS } from "@/lib/services/creator-strategy";
import { strategyNoticeHref } from "@/lib/strategy-notices";
import { createUserClient } from "@/lib/supabase/server";

export interface StrategyActionState {
  status: "idle" | "error";
  message: string | null;
  retryable: boolean;
  /** A Free plan allowance was used up: show Upgrade to Pro. */
  upgrade?: boolean;
}

/**
 * Generates (or regenerates, replacing) the signed-in creator's strategy. On
 * success it redirects back to the top of /app/strategy with a toast notice;
 * on failure it returns the inline error.
 */
export async function generateStrategyAction(): Promise<StrategyActionState> {
  // Public POST endpoint: identity only from Clerk's session.
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "strategy_generation_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    const { message, retryable } = STRATEGY_ERRORS.persistence_error;
    return { status: "error", message, retryable };
  }

  const result = await generateCreatorStrategy(client, userId, { run: runStructured });
  if (!result.ok) {
    return { status: "error", message: result.message, retryable: result.retryable, upgrade: result.code === "upgrade_required" };
  }

  revalidatePath("/app");
  revalidatePath("/app/strategy");
  redirect(strategyNoticeHref(result.version === 1 ? "strategy_created" : "strategy_regenerated", result.version));
}
