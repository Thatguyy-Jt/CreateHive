import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiDbClient } from "@/lib/ai/limits";
import { LIMIT_WINDOW_MS } from "@/lib/ai/limits";
import { getAiUsage } from "@/lib/services/ai-usage";
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
