import { describe, expect, it, vi } from "vitest";
import type { PaystackClient } from "@/lib/billing/paystack";
import {
  deleteCreatorData,
  EXPORT_PAGE_SIZE,
  EXPORT_TABLES,
  exportCreatorData,
  isRenewingPaystack,
  type AccountDeps,
} from "@/lib/services/account-data";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER = "user_alice";
const NOW = Date.parse("2026-10-23T12:00:00Z");

const RENEWING = {
  provider: "paystack",
  provider_subscription_id: "SUB_1",
  provider_email_token: "tok_1",
  status: "active",
  cancel_at_period_end: false,
};

function paystack(result: { ok: true; data: null } | { ok: false; code: string; transient: boolean }) {
  const disableSubscription = vi.fn(async () => result);
  return { client: { disableSubscription } as unknown as PaystackClient, disableSubscription };
}

function deps(subscription: FakeResult, paystackClient: PaystackClient | null, users: FakeResult = {}) {
  const fake = fakeSupabase({ subscriptions: subscription, users });
  const accountDeps: AccountDeps = { db: fake.client, paystack: paystackClient };
  return { ...fake, deps: accountDeps };
}

describe("exportCreatorData", () => {
  const emptyTables = () =>
    Object.fromEntries(Object.keys(EXPORT_TABLES).map((table) => [table, { data: [] }])) as Record<string, FakeResult>;

  it("strips user_id and provider columns from every row", async () => {
    const { client } = fakeSupabase({
      ...emptyTables(),
      users: { data: { email: "a@example.com", display_name: null, created_at: "2026-10-01T00:00:00Z" } },
      subscriptions: { data: [{ id: "s1", user_id: USER, plan: "pro", provider_email_token: "tok", provider_customer_id: "CUS" }] },
      payments: { data: [{ id: "p1", user_id: USER, amount_minor: 1, provider_order_id: "o", provider_customer_id: "c" }] },
      content_ideas: { data: [{ id: "i1", user_id: USER, topic: "Topic" }] },
    });

    const result = await exportCreatorData(client, USER, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exported_at).toBe(new Date(NOW).toISOString());
    expect(result.data.account?.email).toBe("a@example.com");
    expect(result.data.tables.subscriptions).toEqual([{ id: "s1", plan: "pro" }]);
    expect(result.data.tables.payments).toEqual([{ id: "p1", amount_minor: 1 }]);
    expect(result.data.tables.content_ideas).toEqual([{ id: "i1", topic: "Topic" }]);
    expect(JSON.stringify(result.data)).not.toContain(USER);
  });

  it("filters every table by the creator and pages past the row cap", async () => {
    const full = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: `v${i}`, user_id: USER }));
    let page = 0;
    const { client, queries } = fakeSupabase({
      ...emptyTables(),
      users: { data: null },
      content_versions: () => ({ data: page++ === 0 ? full : [{ id: "last", user_id: USER }] }),
    });

    const result = await exportCreatorData(client, USER, NOW);
    expect(result.ok && result.data.tables.content_versions).toHaveLength(EXPORT_PAGE_SIZE + 1);

    const versionPages = queries.filter((q) => q.table === "content_versions");
    expect(versionPages.map((q) => q.filters.find(([m]) => m === "range"))).toEqual([
      ["range", 0, EXPORT_PAGE_SIZE - 1],
      ["range", EXPORT_PAGE_SIZE, 2 * EXPORT_PAGE_SIZE - 1],
    ]);
    for (const q of queries.filter((q) => q.table !== "users")) {
      expect(q.filters).toContainEqual(["eq", "user_id", USER]);
    }
  });

  it("fails the whole export when one table can't be read", async () => {
    const { client } = fakeSupabase({ ...emptyTables(), users: { data: null }, payments: { error: pgError() } });
    expect(await exportCreatorData(client, USER, NOW)).toEqual({ ok: false });
  });

  it("never throws", async () => {
    const { client } = fakeSupabase({ users: new Error("network") });
    expect(await exportCreatorData(client, USER, NOW)).toEqual({ ok: false });
  });
});

describe("isRenewingPaystack", () => {
  it.each([
    [null, false],
    [RENEWING, true],
    [{ ...RENEWING, status: "past_due" }, true],
    [{ ...RENEWING, status: "canceled" }, false],
    [{ ...RENEWING, cancel_at_period_end: true }, false],
    [{ ...RENEWING, provider: null }, false],
    [{ ...RENEWING, provider_subscription_id: null }, false],
  ])("%o → %s", (row, expected) => {
    expect(isRenewingPaystack(row)).toBe(expected);
  });
});

describe("deleteCreatorData", () => {
  const deletes = (queries: RecordedQuery[]) => queries.filter((q) => q.op === "delete");

  it.each([
    ["no subscription", null],
    ["a free row", { ...RENEWING, provider: null, provider_subscription_id: null }],
    ["a cancelled plan", { ...RENEWING, status: "canceled" }],
    ["a non-renewing plan", { ...RENEWING, cancel_at_period_end: true }],
  ])("with %s, skips Paystack and deletes the users row", async (_label, row) => {
    const pay = paystack({ ok: true, data: null });
    const { deps: d, queries } = deps({ data: row }, pay.client);

    expect(await deleteCreatorData(d, USER)).toEqual({ ok: true });
    expect(pay.disableSubscription).not.toHaveBeenCalled();
    expect(deletes(queries)).toEqual([expect.objectContaining({ table: "users", filters: [["eq", "id", USER]] })]);
  });

  it("disables a renewing subscription before deleting", async () => {
    const pay = paystack({ ok: true, data: null });
    const { deps: d, queries } = deps({ data: RENEWING }, pay.client, {});
    pay.disableSubscription.mockImplementation(async () => {
      expect(deletes(queries)).toHaveLength(0);
      return { ok: true, data: null };
    });

    expect(await deleteCreatorData(d, USER)).toEqual({ ok: true });
    expect(pay.disableSubscription).toHaveBeenCalledWith("SUB_1", "tok_1");
    expect(deletes(queries)).toHaveLength(1);
  });

  it("deletes nothing when Paystack refuses the disable", async () => {
    const pay = paystack({ ok: false, code: "http_500", transient: true });
    const { deps: d, queries } = deps({ data: RENEWING }, pay.client);

    expect(await deleteCreatorData(d, USER)).toEqual({ ok: false, code: "billing_cancel_failed" });
    expect(deletes(queries)).toHaveLength(0);
  });

  it("deletes nothing when Paystack isn't configured", async () => {
    const { deps: d, queries } = deps({ data: RENEWING }, null);
    expect(await deleteCreatorData(d, USER)).toEqual({ ok: false, code: "billing_unavailable" });
    expect(deletes(queries)).toHaveLength(0);
  });

  it("deletes nothing when the subscription can't be read", async () => {
    const { deps: d, queries } = deps({ error: pgError() }, null);
    expect(await deleteCreatorData(d, USER)).toEqual({ ok: false, code: "persistence_error" });
    expect(deletes(queries)).toHaveLength(0);
  });

  it("reports a failed delete", async () => {
    const { deps: d } = deps({ data: null }, null, { error: pgError() });
    expect(await deleteCreatorData(d, USER)).toEqual({ ok: false, code: "persistence_error" });
  });

  it("never throws", async () => {
    const { deps: d } = deps(new Error("network") as never, null);
    expect(await deleteCreatorData(d, USER)).toEqual({ ok: false, code: "persistence_error" });
  });
});
