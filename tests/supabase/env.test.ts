import { describe, expect, it } from "vitest";
import { getSupabaseConfig, getSupabaseSecretKey, SupabaseEnvError } from "@/lib/supabase/env";

describe("Supabase env", () => {
  it("reads the URL and publishable key", () => {
    expect(
      getSupabaseConfig({
        SUPABASE_URL: "https://abc.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    ).toEqual({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_x" });
  });

  it("names missing or invalid variables without echoing values", () => {
    const secret = "sb_publishable_should_not_leak";
    try {
      getSupabaseConfig({ SUPABASE_URL: "not-a-url", SUPABASE_PUBLISHABLE_KEY: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SupabaseEnvError);
      expect((error as SupabaseEnvError).variables.sort()).toEqual([
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_URL",
      ]);
    }

    try {
      getSupabaseConfig({ SUPABASE_URL: secret });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it.each([
    "https://abc.supabase.co/rest/v1/",
    "https://abc.supabase.co/rest/v1",
    "https://abc.supabase.co/?x=1",
    "ftp://abc.supabase.co",
  ])("rejects %s, naming the rule", (url) => {
    expect(() => getSupabaseConfig({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "k" })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it("explains the /rest/v1 mistake", () => {
    expect(() =>
      getSupabaseConfig({ SUPABASE_URL: "https://abc.supabase.co/rest/v1/", SUPABASE_PUBLISHABLE_KEY: "k" }),
    ).toThrow(/no path such as \/rest\/v1/);
  });

  it("accepts the origin with or without a trailing slash", () => {
    for (const url of ["https://abc.supabase.co", "https://abc.supabase.co/"]) {
      expect(getSupabaseConfig({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "k" }).url).toBe(url);
    }
  });

  it("requires the secret key only when asked for it", () => {
    expect(() => getSupabaseSecretKey({})).toThrow(/SUPABASE_SECRET_KEY/);
    expect(getSupabaseSecretKey({ SUPABASE_SECRET_KEY: "sb_secret_x" })).toBe("sb_secret_x");
  });
});
