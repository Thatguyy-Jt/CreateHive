import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABANDONED_AFTER_MS,
  deleteExpiredSignals,
  expireAbandonedGenerations,
  runDailyMaintenance,
} from "@/lib/jobs/daily-maintenance";
import type { BillingDeps } from "@/lib/services/billing";
import { fakeSupabase, pgError } from "../services/fake-supabase";

const NOW = Date.parse("2026-10-23T04:00:00Z");

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  logs = (["error", "warn", "info"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => logs.forEach((spy) => spy.mockRestore()));

describe("expireAbandonedGenerations", () => {
  it("fails only pending rows older than the cutoff, and returns the count", async () => {
    const { client, queries } = fakeSupabase({ ai_generations: { count: 2 } });

    expect(await expireAbandonedGenerations(client, NOW)).toEqual({ ok: true, count: 2 });
    expect(queries[0]).toMatchObject({
      op: "update",
      payload: { status: "failed", error_code: "abandoned", completed_at: new Date(NOW).toISOString() },
      filters: [
        ["eq", "status", "pending"],
        ["lt", "created_at", new Date(NOW - ABANDONED_AFTER_MS).toISOString()],
      ],
    });
  });

  it("reports a DB error", async () => {
    const { client } = fakeSupabase({ ai_generations: { error: pgError("42501") } });
    expect(await expireAbandonedGenerations(client, NOW)).toEqual({ ok: false, db_code: "42501" });
  });
});

describe("deleteExpiredSignals", () => {
  it("deletes rows past their expiry for every creator", async () => {
    const { client, queries } = fakeSupabase({ research_signals: { count: 5 } });

    expect(await deleteExpiredSignals(client, NOW)).toEqual({ ok: true, count: 5 });
    expect(queries[0]).toMatchObject({ op: "delete", filters: [["lt", "expires_at", new Date(NOW).toISOString()]] });
  });
});

describe("runDailyMaintenance", () => {
  it("runs every task and reports counts; Paystack is skipped without billing", async () => {
    const { client } = fakeSupabase({ ai_generations: { count: 1 }, research_signals: { count: 0 } });

    expect(await runDailyMaintenance({ db: client, billing: null, now: () => NOW })).toEqual({
      ok: true,
      tasks: {
        abandoned_generations: { ok: true, count: 1 },
        expired_signals: { ok: true, count: 0 },
        paystack: { ok: true, skipped: true },
      },
    });
  });

  it("keeps going when one task fails, and reports the run as failed", async () => {
    const { client, queries } = fakeSupabase({
      ai_generations: new Error("network"),
      research_signals: { count: 3 },
    });

    const summary = await runDailyMaintenance({ db: client, billing: null, now: () => NOW });

    expect(summary.ok).toBe(false);
    expect(summary.tasks.abandoned_generations).toEqual({ ok: false });
    expect(summary.tasks.expired_signals).toEqual({ ok: true, count: 3 });
    expect(queries.map((q) => q.table)).toEqual(["ai_generations", "research_signals"]);
  });

  it("reports Paystack reconciliation counts, and a failed reconciliation", async () => {
    const { client } = fakeSupabase({ ai_generations: { count: 0 }, research_signals: { count: 0 } });
    const billing = {
      paystack: {},
      config: { appUrl: "x", paystack: { secretKey: "k", planCodes: { pro: "P" } } },
      db: fakeSupabase({ subscriptions: { data: [] }, payments: { error: pgError() } }).client,
      now: () => NOW,
    } as unknown as BillingDeps;

    const summary = await runDailyMaintenance({ db: client, billing, now: () => NOW });
    expect(summary.ok).toBe(false);
    expect(summary.tasks.paystack).toEqual({ ok: false });
  });
});
