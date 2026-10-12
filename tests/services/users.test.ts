import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureUser } from "@/lib/services/users";

type PgError = { code: string; message: string };
type Step = { data?: unknown; error?: PgError | null } | Error;

/**
 * Minimal stand-in for the supabase-js query builder: `from("users")` then
 * either `select().eq().maybeSingle()` or `insert()`. Records inserts.
 */
function fakeClient(selectResult: Step, insertResult: Step = { error: null }) {
  const inserts: unknown[] = [];
  const settle = (step: Step) =>
    step instanceof Error ? Promise.reject(step) : Promise.resolve({ data: null, error: null, ...step });

  const client = {
    from: (table: string) => {
      expect(table).toBe("users");
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => settle(selectResult) }) }),
        insert: (row: unknown) => {
          inserts.push(row);
          return settle(insertResult);
        },
      };
    },
  };
  return { client: client as unknown as Parameters<typeof ensureUser>[0], inserts };
}

const identity = (email: string | null = "creator@example.com") => ({
  id: "user_123",
  loadEmail: vi.fn(async () => email),
});

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

describe("ensureUser", () => {
  it("does nothing when the row exists, and skips the email lookup", async () => {
    const { client, inserts } = fakeClient({ data: { id: "user_123" } });
    const who = identity();

    await expect(ensureUser(client, who)).resolves.toEqual({ ok: true, created: false });
    expect(inserts).toEqual([]);
    expect(who.loadEmail).not.toHaveBeenCalled();
  });

  it("creates the row with id and email when missing", async () => {
    const { client, inserts } = fakeClient({ data: null });

    await expect(ensureUser(client, identity())).resolves.toEqual({ ok: true, created: true });
    expect(inserts).toEqual([{ id: "user_123", email: "creator@example.com" }]);
  });

  it("stores a null email when Clerk has none", async () => {
    const { client, inserts } = fakeClient({ data: null });

    await ensureUser(client, identity(null));
    expect(inserts).toEqual([{ id: "user_123", email: null }]);
  });

  it("treats a concurrent insert (unique violation) as success", async () => {
    const { client } = fakeClient(
      { data: null },
      { error: { code: "23505", message: "duplicate key" } },
    );

    await expect(ensureUser(client, identity())).resolves.toEqual({ ok: true, created: false });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("returns ok:false and logs when the select fails", async () => {
    const { client, inserts } = fakeClient({ error: { code: "42501", message: "permission denied" } });

    await expect(ensureUser(client, identity())).resolves.toEqual({ ok: false });
    expect(inserts).toEqual([]);
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("returns ok:false and logs when the insert fails", async () => {
    const { client } = fakeClient({ data: null }, { error: { code: "42501", message: "rls" } });

    await expect(ensureUser(client, identity())).resolves.toEqual({ ok: false });
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("never throws, even when the client does", async () => {
    const { client } = fakeClient(new TypeError("fetch failed"));

    await expect(ensureUser(client, identity())).resolves.toEqual({ ok: false });
  });

  it("logs no id, email or message text", async () => {
    const { client } = fakeClient(
      { data: null },
      { error: { code: "XX000", message: "detail about user_123" } },
    );

    await ensureUser(client, identity());
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("ensure_user_failed");
    expect(logged).not.toContain("user_123");
    expect(logged).not.toContain("creator@example.com");
  });
});
