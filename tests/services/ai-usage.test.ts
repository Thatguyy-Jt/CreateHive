import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiDbClient } from "@/lib/ai/limits";
import { LIMIT_WINDOW_MS } from "@/lib/ai/limits";
import { getAiUsage, getPlanUsage } from "@/lib/services/ai-usage";
import { fakeDb } from "../ai/fake-db";

const USER_ID = "user_secret_123";
const NOW = 1_760_000_000_000;

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

describe("getAiUsage", () => {
  it.each([
    [0, { used: 0, limit: 25, remaining: 25 }],
    [10, { used: 10, limit: 25, remaining: 15 }],
    [25, { used: 25, limit: 25, remaining: 0 }],
    // The cap isn't atomic, so a creator can briefly be over it.
    [27, { used: 27, limit: 25, remaining: 0 }],
  ])("with %i generations returns used, limit and a non-negative remaining", async (count, expected) => {
    const { db } = fakeDb({ count });
    await expect(getAiUsage(db, USER_ID, 25, NOW)).resolves.toEqual({ ok: true, ...expected });
  });

  it("counts the given creator's last 24 hours the same way the AI service does", async () => {
    const { db, limitQueries } = fakeDb({ count: 3 });

    await getAiUsage(db, USER_ID, 25, NOW);

    expect(limitQueries).toHaveLength(1);
    expect(limitQueries[0].filters).toEqual([
      ["user_id", USER_ID],
      ["created_at>=", new Date(NOW - LIMIT_WINDOW_MS).toISOString()],
    ]);
    expect(limitQueries[0].or).toBe("status.neq.failed,error_code.eq.invalid_output");
  });

  it("returns { ok: false } when the count fails, logging no ids", async () => {
    const { db } = fakeDb({ countError: { code: "42501", message: "permission denied" } });

    await expect(getAiUsage(db, USER_ID, 25, NOW)).resolves.toEqual({ ok: false });
    const logs = errorLog.mock.calls.map((args: unknown[]) => String(args[0])).join("\n");
    expect(logs).toContain("ai_usage_read_failed");
    expect(logs).toContain("42501");
    expect(logs).not.toContain(USER_ID);
  });

  it("returns { ok: false } instead of throwing when the client throws", async () => {
    const db = {
      from: () => {
        throw new TypeError("fetch failed");
      },
    } as unknown as AiDbClient;

    await expect(getAiUsage(db, USER_ID, 25, NOW)).resolves.toEqual({ ok: false });
    expect(String(errorLog.mock.calls[0][0])).toContain("TypeError");
  });
});

describe("getPlanUsage", () => {
  const pro = { plan: "pro", status: "active", provider: "paystack", current_period_end: "2099-01-01T00:00:00Z", cancel_at_period_end: true };

  it("counts each feature's uses in the last 30 days against the plan's allowance", async () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ kind: "content_package" })),
      { kind: "content_diagnosis" },
      { kind: "smoke_test" },
    ];
    const { db, limitQueries } = fakeDb({ rows });

    const result = await getPlanUsage(db, USER_ID, NOW);

    expect(result.now).toBe(NOW);
    expect(result.allowance.plan.id).toBe("free");
    expect(result.monthly.ok).toBe(true);
    const byKind = Object.fromEntries(
      (result.monthly.ok ? result.monthly.features : []).map((f) => [f.kind, [f.used, f.limit]]),
    );
    expect(byKind).toMatchObject({ content_package: [3, 5], content_diagnosis: [1, 3], creator_strategy: [0, 2] });
    expect(byKind).not.toHaveProperty("smoke_test");
    // The same window and failure rule the AI service uses.
    expect(limitQueries[0].filters).toEqual([
      ["user_id", USER_ID],
      ["created_at>=", new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()],
    ]);
    expect(limitQueries[0].or).toBe("status.neq.failed,error_code.eq.invalid_output");
  });

  it("uses Pro allowances for a paying creator", async () => {
    const { db } = fakeDb({ subscription: pro });
    const result = await getPlanUsage(db, USER_ID, NOW);
    expect(result.allowance.plan.id).toBe("pro");
    expect(result.monthly.ok && result.monthly.features.find((f) => f.kind === "content_package")?.limit).toBe(30);
  });

  it("starts the plan read and the usage count together", async () => {
    // Each query only resolves once both have started: run one after the other, this never settles.
    const started: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    const db = {
      from(table: string) {
        started.push(table);
        if (started.length === 2) release();
        const data = table === "subscriptions" ? null : [];
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => unknown) => bothStarted.then(() => resolve({ data, error: null })),
        };
        for (const method of ["select", "eq", "gte", "or", "maybeSingle"]) chain[method] = () => chain;
        return chain;
      },
    } as unknown as AiDbClient;

    const result = await Promise.race([
      getPlanUsage(db, USER_ID, NOW),
      new Promise((_, reject) => setTimeout(() => reject(new Error("reads ran sequentially")), 1000)),
    ]);
    expect(started.sort()).toEqual(["ai_generations", "subscriptions"]);
    expect(result).toMatchObject({ allowance: { plan: { id: "free" } }, monthly: { ok: true } });
  });

  it("reports a failed read without throwing or logging ids", async () => {
    const { db } = fakeDb({ countError: { code: "42501", message: "denied" } });
    await expect(getPlanUsage(db, USER_ID, NOW)).resolves.toMatchObject({ monthly: { ok: false } });
    const logs = errorLog.mock.calls.map((args: unknown[]) => String(args[0])).join("\n");
    expect(logs).toContain("ai_usage_read_failed");
    expect(logs).not.toContain(USER_ID);
  });
});
