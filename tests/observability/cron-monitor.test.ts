import { readFileSync } from "node:fs";
import path from "node:path";
import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_MAINTENANCE_MONITOR, monitorCron, reportCronFailure } from "@/lib/observability/cron-monitor";

vi.mock("@sentry/nextjs", () => ({ captureCheckIn: vi.fn(), flush: vi.fn() }));

const checkIn = vi.mocked(Sentry.captureCheckIn);
const flush = vi.mocked(Sentry.flush);
const statuses = () => checkIn.mock.calls.map(([c]) => c.status);

beforeEach(() => {
  checkIn.mockReset().mockReturnValue("check-1");
  flush.mockReset().mockResolvedValue(true);
});

describe("monitorCron", () => {
  it("reports in_progress then ok, with the monitor config, and flushes", async () => {
    const result = await monitorCron(DAILY_MAINTENANCE_MONITOR, async () => ({ ok: true, n: 1 }));

    expect(result).toEqual({ ok: true, n: 1 });
    expect(statuses()).toEqual(["in_progress", "ok"]);
    expect(checkIn.mock.calls[1][0]).toMatchObject({ checkInId: "check-1", monitorSlug: "daily-maintenance" });
    expect(checkIn.mock.calls[0][1]).toBe(DAILY_MAINTENANCE_MONITOR.config);
    expect(flush).toHaveBeenCalled();
  });

  it("reports error for a failed result", async () => {
    await monitorCron(DAILY_MAINTENANCE_MONITOR, async () => ({ ok: false }));
    expect(statuses()).toEqual(["in_progress", "error"]);
  });

  it("reports error and rethrows when the job throws", async () => {
    await expect(
      monitorCron(DAILY_MAINTENANCE_MONITOR, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(statuses()).toEqual(["in_progress", "error"]);
    expect(flush).toHaveBeenCalled();
  });

  it("never lets Sentry change the job's outcome", async () => {
    checkIn.mockImplementation(() => {
      throw new Error("sentry down");
    });
    flush.mockRejectedValue(new Error("sentry down"));
    expect(await monitorCron(DAILY_MAINTENANCE_MONITOR, async () => ({ ok: true }))).toEqual({ ok: true });
  });
});

describe("reportCronFailure", () => {
  it("sends one error check-in and flushes", async () => {
    await reportCronFailure(DAILY_MAINTENANCE_MONITOR);
    expect(checkIn.mock.calls).toEqual([[{ monitorSlug: "daily-maintenance", status: "error" }, DAILY_MAINTENANCE_MONITOR.config]]);
    expect(flush).toHaveBeenCalled();
  });
});

describe("DAILY_MAINTENANCE_MONITOR", () => {
  it("has the same schedule as the Vercel cron", () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/daily");
    expect(DAILY_MAINTENANCE_MONITOR.config.schedule.value).toBe(cron?.schedule);
  });
});
