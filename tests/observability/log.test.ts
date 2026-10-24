import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent, type SafeLogFields } from "@/lib/observability/log";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(Sentry.captureMessage).mockReset();
});

afterEach(() => {
  errorLog.mockRestore();
  warnLog.mockRestore();
});

describe("logEvent", () => {
  it("prints one JSON line and sends errors to Sentry tagged with the same fields", () => {
    logEvent("error", "ai_generation_failed", {
      kind: "smoke_test",
      model: "gpt-6-luna",
      code: "provider_error",
      latency_ms: 250,
      variables: ["OPENAI_API_KEY", "SUPABASE_URL"],
    });

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorLog.mock.calls[0][0] as string)).toEqual({
      event: "ai_generation_failed",
      kind: "smoke_test",
      model: "gpt-6-luna",
      code: "provider_error",
      latency_ms: 250,
      variables: ["OPENAI_API_KEY", "SUPABASE_URL"],
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith("ai_generation_failed", {
      level: "error",
      tags: {
        kind: "smoke_test",
        model: "gpt-6-luna",
        code: "provider_error",
        latency_ms: "250",
        variables: "OPENAI_API_KEY,SUPABASE_URL",
      },
    });
  });

  it("keeps warnings in the console only", () => {
    logEvent("warn", "ai_cost_unknown", { kind: "smoke_test", model: "gpt-x" });

    expect(warnLog).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("keeps info in the console only, with counts", () => {
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    logEvent("info", "cron_task_done", { name: "expired_signals", count: 3 });

    expect(JSON.parse(infoLog.mock.calls[0][0] as string)).toEqual({
      event: "cron_task_done",
      name: "expired_signals",
      count: 3,
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    infoLog.mockRestore();
  });

  it("works with no fields", () => {
    logEvent("error", "something_happened");
    expect(JSON.parse(errorLog.mock.calls[0][0] as string)).toEqual({ event: "something_happened" });
  });

  it("drops keys outside the allow-list at runtime, in the console and in Sentry", () => {
    const sneaky = {
      kind: "smoke_test",
      userId: "user_secret_123",
      email: "creator@example.com",
      prompt: "private creator text",
    } as SafeLogFields;

    logEvent("error", "ai_generation_failed", sneaky);

    const printed = errorLog.mock.calls[0][0] as string;
    expect(JSON.parse(printed)).toEqual({ event: "ai_generation_failed", kind: "smoke_test" });
    const sent = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls);
    for (const secret of ["user_secret_123", "creator@example.com", "private creator text"]) {
      expect(printed).not.toContain(secret);
      expect(sent).not.toContain(secret);
    }
  });

  it("rejects unsafe keys at compile time", () => {
    // @ts-expect-error `userId` is not a safe log field
    logEvent("error", "x", { userId: "user_123" });
    // @ts-expect-error `email` is not a safe log field
    logEvent("error", "x", { email: "creator@example.com" });
    // @ts-expect-error an Error object is not a safe log field
    logEvent("error", "x", { error: new Error("boom") });
  });

  it("does not throw when Sentry does", () => {
    vi.mocked(Sentry.captureMessage).mockImplementation(() => {
      throw new Error("sentry is down");
    });

    expect(() => logEvent("error", "ai_generation_failed", { kind: "smoke_test" })).not.toThrow();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
