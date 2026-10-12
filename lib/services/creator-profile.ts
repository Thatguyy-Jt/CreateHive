import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/observability/log";
import type { BrandProfileInput, CreatorProfileInput } from "@/lib/schemas/creator";
import type { OnboardingStatus } from "@/lib/schemas/enums";
import type { Database, Tables } from "@/lib/supabase/database.types";

type ProfileClient = Pick<SupabaseClient<Database>, "from">;

export type CreatorProfileRow = Pick<
  Tables<"creator_profiles">,
  | "niche"
  | "audience_description"
  | "goals"
  | "platforms"
  | "posting_capacity_per_week"
  | "experience_level"
  | "onboarding_status"
>;
export type BrandProfileRow = Pick<
  Tables<"brand_profiles">,
  "tone" | "voice_traits" | "do_list" | "dont_list" | "sample_text"
>;

export interface OnboardingState {
  profile: CreatorProfileRow | null;
  brand: BrandProfileRow | null;
  status: OnboardingStatus;
}

export type ProfileErrorCode = "db_error" | "missing_profile";
export type ProfileResult<T> = { ok: true; data: T } | { ok: false; code: ProfileErrorCode };

const PROFILE_COLUMNS =
  "niche, audience_description, goals, platforms, posting_capacity_per_week, experience_level, onboarding_status";
const BRAND_COLUMNS = "tone, voice_traits, do_list, dont_list, sample_text";

// Stable event names with stage and code only: never creator text or ids.
function failed<T>(event: string, stage: string, code?: string): ProfileResult<T> {
  logEvent("error", event, { stage, db_code: code });
  return { ok: false, code: "db_error" };
}

function unexpected<T>(event: string, error: unknown): ProfileResult<T> {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
  return { ok: false, code: "db_error" };
}

/**
 * Everything onboarding needs to prefill and gate. Pass a client acting as the
 * creator so RLS limits the reads to their own rows. Never throws.
 */
export async function getOnboardingState(client: ProfileClient, userId: string): Promise<ProfileResult<OnboardingState>> {
  try {
    const [profile, brand] = await Promise.all([
      client.from("creator_profiles").select(PROFILE_COLUMNS).eq("user_id", userId).maybeSingle(),
      client.from("brand_profiles").select(BRAND_COLUMNS).eq("user_id", userId).maybeSingle(),
    ]);
    if (profile.error) return failed("profile_read_failed", "profile", profile.error.code);
    if (brand.error) return failed("profile_read_failed", "brand", brand.error.code);
    return {
      ok: true,
      data: {
        profile: profile.data,
        brand: brand.data,
        status: (profile.data?.onboarding_status as OnboardingStatus | undefined) ?? "not_started",
      },
    };
  } catch (error) {
    return unexpected("profile_read_failed", error);
  }
}

/**
 * Upserts the creator profile. Moves onboarding to `in_progress`, but never
 * downgrades a creator who already completed it (re-editing their profile).
 */
export async function saveCreatorProfile(
  client: ProfileClient,
  userId: string,
  input: CreatorProfileInput,
): Promise<ProfileResult<{ status: OnboardingStatus }>> {
  try {
    const existing = await client
      .from("creator_profiles")
      .select("onboarding_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) return failed("profile_save_failed", "select", existing.error.code);

    const status: OnboardingStatus = existing.data?.onboarding_status === "completed" ? "completed" : "in_progress";
    const saved = await client.from("creator_profiles").upsert(
      {
        user_id: userId,
        niche: input.niche,
        audience_description: input.audience_description,
        goals: input.goals,
        platforms: input.platforms,
        posting_capacity_per_week: input.posting_capacity_per_week,
        experience_level: input.experience_level,
        onboarding_status: status,
      },
      { onConflict: "user_id" },
    );
    if (saved.error) return failed("profile_save_failed", "upsert", saved.error.code);
    return { ok: true, data: { status } };
  } catch (error) {
    return unexpected("profile_save_failed", error);
  }
}

/**
 * Upserts the brand voice and completes onboarding. Requires the profile row:
 * a strategy can't be built from a voice alone.
 */
export async function saveBrandProfile(
  client: ProfileClient,
  userId: string,
  input: BrandProfileInput,
): Promise<ProfileResult<{ status: OnboardingStatus }>> {
  try {
    const profile = await client.from("creator_profiles").select("user_id").eq("user_id", userId).maybeSingle();
    if (profile.error) return failed("brand_save_failed", "select", profile.error.code);
    if (!profile.data) return { ok: false, code: "missing_profile" };

    const saved = await client.from("brand_profiles").upsert(
      {
        user_id: userId,
        tone: input.tone,
        voice_traits: input.voice_traits,
        do_list: input.do_list,
        dont_list: input.dont_list,
        sample_text: input.sample_text,
      },
      { onConflict: "user_id" },
    );
    if (saved.error) return failed("brand_save_failed", "upsert", saved.error.code);

    const completed = await client
      .from("creator_profiles")
      .update({ onboarding_status: "completed" })
      .eq("user_id", userId);
    if (completed.error) return failed("brand_save_failed", "status", completed.error.code);
    return { ok: true, data: { status: "completed" } };
  } catch (error) {
    return unexpected("brand_save_failed", error);
  }
}
