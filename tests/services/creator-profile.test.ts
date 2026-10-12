import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandProfileInput, CreatorProfileInput } from "@/lib/schemas/creator";
import { getOnboardingState, saveBrandProfile, saveCreatorProfile } from "@/lib/services/creator-profile";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_profile";

const profileInput: CreatorProfileInput = {
  niche: "Home fitness",
  audience_description: "Busy parents who want to get fit.",
  goals: ["grow_audience"],
  platforms: ["youtube"],
  posting_capacity_per_week: 3,
  experience_level: "beginner",
};
const brandInput: BrandProfileInput = { tone: "warm", voice_traits: [], do_list: [], dont_list: [], sample_text: null };

/** Routes a table's queries by operation. */
const byOp = (results: Partial<Record<RecordedQuery["op"], FakeResult>>) => (query: RecordedQuery) =>
  results[query.op] ?? {};

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("saveCreatorProfile", () => {
  it("creates the profile as in_progress, keyed on the session user", async () => {
    const { client, queries } = fakeSupabase({ creator_profiles: byOp({ select: { data: null } }) });

    await expect(saveCreatorProfile(client, USER_ID, profileInput)).resolves.toEqual({
      ok: true,
      data: { status: "in_progress" },
    });
    const upsert = queries.find((q) => q.op === "upsert")!;
    expect(upsert.payload).toMatchObject({ user_id: USER_ID, niche: "Home fitness", onboarding_status: "in_progress" });
    expect(upsert.options).toEqual({ onConflict: "user_id" });
  });

  it("never downgrades a completed onboarding", async () => {
    const { client, queries } = fakeSupabase({
      creator_profiles: byOp({ select: { data: { onboarding_status: "completed" } } }),
    });
    await expect(saveCreatorProfile(client, USER_ID, profileInput)).resolves.toEqual({
      ok: true,
      data: { status: "completed" },
    });
    expect(queries.find((q) => q.op === "upsert")!.payload).toMatchObject({ onboarding_status: "completed" });
  });

  it("returns db_error without throwing when the write fails", async () => {
    const { client } = fakeSupabase({
      creator_profiles: byOp({ select: { data: null }, upsert: { error: pgError() } }),
    });
    await expect(saveCreatorProfile(client, USER_ID, profileInput)).resolves.toEqual({ ok: false, code: "db_error" });
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("never throws", async () => {
    const { client } = fakeSupabase({ creator_profiles: new TypeError("fetch failed") });
    await expect(saveCreatorProfile(client, USER_ID, profileInput)).resolves.toEqual({ ok: false, code: "db_error" });
  });
});

describe("saveBrandProfile", () => {
  it("saves the voice and completes onboarding", async () => {
    const { client, queries } = fakeSupabase({
      creator_profiles: byOp({ select: { data: { user_id: USER_ID } } }),
      brand_profiles: {},
    });
    await expect(saveBrandProfile(client, USER_ID, brandInput)).resolves.toEqual({
      ok: true,
      data: { status: "completed" },
    });
    expect(queries.find((q) => q.table === "brand_profiles")!.payload).toMatchObject({ user_id: USER_ID, tone: "warm" });
    const update = queries.find((q) => q.op === "update")!;
    expect(update.payload).toEqual({ onboarding_status: "completed" });
    expect(update.filters).toContainEqual(["eq", "user_id", USER_ID]);
  });

  it("refuses without a profile and writes nothing", async () => {
    const { client, queries } = fakeSupabase({ creator_profiles: byOp({ select: { data: null } }) });
    await expect(saveBrandProfile(client, USER_ID, brandInput)).resolves.toEqual({ ok: false, code: "missing_profile" });
    expect(queries.filter((q) => q.op !== "select")).toEqual([]);
  });

  it("does not complete onboarding when the voice fails to save", async () => {
    const { client, queries } = fakeSupabase({
      creator_profiles: byOp({ select: { data: { user_id: USER_ID } } }),
      brand_profiles: { error: pgError() },
    });
    await expect(saveBrandProfile(client, USER_ID, brandInput)).resolves.toEqual({ ok: false, code: "db_error" });
    expect(queries.some((q) => q.op === "update")).toBe(false);
  });
});

describe("getOnboardingState", () => {
  it("defaults to not_started without a profile", async () => {
    const { client } = fakeSupabase({ creator_profiles: { data: null }, brand_profiles: { data: null } });
    await expect(getOnboardingState(client, USER_ID)).resolves.toEqual({
      ok: true,
      data: { profile: null, brand: null, status: "not_started" },
    });
  });

  it("returns db_error on a read failure", async () => {
    const { client } = fakeSupabase({ creator_profiles: { error: pgError() }, brand_profiles: { data: null } });
    await expect(getOnboardingState(client, USER_ID)).resolves.toEqual({ ok: false, code: "db_error" });
  });
});
