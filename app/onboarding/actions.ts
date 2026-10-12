"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runStructured } from "@/lib/ai";
import { logEvent } from "@/lib/observability/log";
import { brandProfileInput, creatorProfileInput } from "@/lib/schemas/creator";
import { saveBrandProfile, saveCreatorProfile } from "@/lib/services/creator-profile";
import { generateCreatorStrategy, getCreatorStrategy } from "@/lib/services/creator-strategy";
import { ensureCurrentUser } from "@/lib/services/current-user";
import { strategyNoticeHref } from "@/lib/strategy-notices";
import { createUserClient } from "@/lib/supabase/server";

// Server actions are public POST endpoints: each one authenticates itself and
// takes the creator's id only from Clerk's session, never from the form.

export interface OnboardingFormState {
  status: "idle" | "error" | "saved";
  fieldErrors: Record<string, string>;
  message: string | null;
}

const SAVE_FAILED = "We couldn't save your answers. Please try again in a moment.";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function texts(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((value): value is string => typeof value === "string");
}

const lines = (value: string) => value.split(/\r?\n/);

function invalid(error: z.ZodError): OnboardingFormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return { status: "error", fieldErrors, message: "Please fix the highlighted fields." };
}

const failure = (message: string): OnboardingFormState => ({ status: "error", fieldErrors: {}, message });

/** The creator's `users` row (every table references it) and an RLS-scoped client. */
async function creatorClient(userId: string) {
  // /onboarding sits outside the /app layout, so a brand-new sign-up may not
  // have their `users` row yet.
  const ensured = await ensureCurrentUser(userId);
  if (!ensured.ok) return null;
  try {
    return createUserClient();
  } catch (error) {
    logEvent("error", "profile_save_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

export async function saveProfileAction(formData: FormData): Promise<OnboardingFormState> {
  const { userId } = await auth.protect();

  const parsed = creatorProfileInput.safeParse({
    niche: text(formData, "niche"),
    audience_description: text(formData, "audience_description"),
    goals: texts(formData, "goals"),
    platforms: texts(formData, "platforms"),
    posting_capacity_per_week: text(formData, "posting_capacity_per_week"),
    experience_level: text(formData, "experience_level"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const client = await creatorClient(userId);
  if (!client) return failure(SAVE_FAILED);

  const saved = await saveCreatorProfile(client, userId, parsed.data);
  if (!saved.ok) return failure(SAVE_FAILED);

  revalidatePath("/app");
  return { status: "saved", fieldErrors: {}, message: null };
}

/**
 * Saves the brand voice (completing onboarding). Builds the strategy only on
 * first setup: when one already exists this is a profile edit, which must not
 * spend a generation or replace the strategy; the creator regenerates
 * explicitly. Always lands on /app/strategy once the voice is saved, so a
 * failed generation never traps the creator here. That page owns the error.
 */
export async function saveVoiceAction(formData: FormData): Promise<OnboardingFormState> {
  const { userId } = await auth.protect();

  const customTraits = text(formData, "custom_traits").split(",");
  const parsed = brandProfileInput.safeParse({
    tone: text(formData, "tone"),
    voice_traits: [...texts(formData, "voice_traits"), ...customTraits],
    do_list: lines(text(formData, "do_list")),
    dont_list: lines(text(formData, "dont_list")),
    sample_text: text(formData, "sample_text"),
  });
  if (!parsed.success) {
    const state = invalid(parsed.error);
    // Custom traits are entered in their own box; point the error there.
    if (state.fieldErrors.voice_traits) state.fieldErrors.custom_traits = state.fieldErrors.voice_traits;
    return state;
  }

  const client = await creatorClient(userId);
  if (!client) return failure(SAVE_FAILED);

  const saved = await saveBrandProfile(client, userId, parsed.data);
  if (!saved.ok) {
    return failure(
      saved.code === "missing_profile" ? "Please complete step 1 (About you) first." : SAVE_FAILED,
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/strategy");

  // Fail safe: if we can't confirm there is no strategy, don't generate one.
  // Replacing a strategy the creator kept would be worse than not building one.
  const existing = await getCreatorStrategy(client, userId);
  if (!existing.ok || existing.strategy) redirect(strategyNoticeHref("profile_saved"));

  const generated = await generateCreatorStrategy(client, userId, { run: runStructured });
  redirect(generated.ok ? strategyNoticeHref("strategy_created", generated.version) : `/app/strategy?error=${generated.code}`);
}
