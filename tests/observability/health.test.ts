import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHealthCheck, type PingResult } from "@/lib/observability/health";

const FULL_ENV = {
  OPENAI_API_KEY: "sk-test",
  PAYSTACK_SECRET_KEY: "sk_test",
  PAYSTACK_PLAN_PRO: "PLN_pro",
  CRON_SECRET: "cron-secret",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_x",
  YOUTUBE_API_KEY: "yt-key",
};

const up = async (): Promise<PingResult> => ({ ok: true });

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("runHealthCheck", () => {
  it("is ok when the database answers and everything is configured", async () => {
    expect(await runHealthCheck({ pingDatabase: up, env: FULL_ENV })).toEqual({
      status: "ok",
      checks: {
        database: "ok",
        ai: "configured",
        billing: "configured",
        cron: "configured",
        account_webhook: "configured",
        youtube: "configured",
      },
    });
  });

  it("is degraded, not down, when optional config is missing", async () => {
    const report = await runHealthCheck({ pingDatabase: up, env: { ...FULL_ENV, PAYSTACK_PLAN_PRO: "", CRON_SECRET: " " } });
    expect(report.status).toBe("degraded");
    expect(report.checks).toMatchObject({ database: "ok", billing: "missing", cron: "missing", ai: "configured" });
  });

  it("counts a deliberate AI pause as configured", async () => {
    const report = await runHealthCheck({ pingDatabase: up, env: { ...FULL_ENV, OPENAI_API_KEY: "", AI_ENABLED: "false" } });
    expect(report.checks.ai).toBe("configured");
  });

  it("is down when the database fails, and logs it", async () => {
    const report = await runHealthCheck({ pingDatabase: async () => ({ ok: false, db_code: "57014" }), env: FULL_ENV });
    expect(report).toMatchObject({ status: "down", checks: { database: "error" } });
    expect(JSON.parse(errorLog.mock.calls[0][0] as string)).toEqual({
      event: "health_check_failed",
      stage: "database",
      db_code: "57014",
    });
  });

  it("is down, not thrown, when the ping throws", async () => {
    const report = await runHealthCheck({
      pingDatabase: async () => {
        throw new TypeError("fetch failed");
      },
      env: FULL_ENV,
    });
    expect(report.status).toBe("down");
  });
});
