import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, asService, asUser, createTestDb, insertRow } from "./helpers";

const A = "user_alice";
const B = "user_bob";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAYSTACK_ONLY = "20261023000100_billing_paystack_only.sql";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await insertRow(db, "users", { id: A });
  await insertRow(db, "users", { id: B });
});

afterAll(async () => {
  await db.close();
});

const payment = (values: Record<string, unknown> = {}) => ({
  user_id: A,
  provider: "paystack",
  kind: "subscription_start",
  plan: "pro",
  reference: "ch_x",
  amount_minor: 1_200_000,
  ...values,
});

describe("billing constraints", () => {
  it("rejects unknown plans, providers and currencies", async () => {
    await expect(asService(db, (tx) => insertRow(tx, "subscriptions", { user_id: A, plan: "gold" }))).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      asService(db, (tx) => insertRow(tx, "subscriptions", { user_id: A, provider: "stripe" })),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asService(db, (tx) => insertRow(tx, "payments", payment({ reference: "ch_usd", currency: "USD" }))),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asService(db, (tx) => insertRow(tx, "payments", payment({ reference: "r", plan: "free" }))),
    ).rejects.toThrow(/check constraint/);
  });

  it("no longer accepts the retired Studio plan", async () => {
    await expect(asService(db, (tx) => insertRow(tx, "subscriptions", { user_id: A, plan: "studio" }))).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      asService(db, (tx) => insertRow(tx, "payments", payment({ reference: "ch_s", plan: "studio" }))),
    ).rejects.toThrow(/check constraint/);
  });

  it("no longer accepts OPay or 30-day passes", async () => {
    await expect(asService(db, (tx) => insertRow(tx, "subscriptions", { user_id: A, provider: "opay" }))).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      asService(db, (tx) => insertRow(tx, "payments", payment({ reference: "ch_o", provider: "opay" }))),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asService(db, (tx) => insertRow(tx, "payments", payment({ reference: "ch_p", kind: "pass" }))),
    ).rejects.toThrow(/check constraint/);
  });

  it("no longer has apply_pass_payment", async () => {
    const { rows } = await db.query("select 1 from pg_proc where proname = 'apply_pass_payment'");
    expect(rows).toHaveLength(0);
  });

  it.each([
    ["card_last4", "40812"],
    ["card_last4", "40a1"],
    ["card_exp", "9/28"],
    ["card_brand", ""],
  ])("rejects an invalid %s (%s)", async (column, value) => {
    await expect(asService(db, (tx) => insertRow(tx, "subscriptions", { user_id: A, [column]: value }))).rejects.toThrow(
      /check constraint/,
    );
  });

  it("keeps references unique per provider", async () => {
    await asService(db, async (tx) => {
      await insertRow(tx, "payments", payment({ reference: "ch_dup" }));
      // Last: a failed statement aborts the transaction.
      await expect(insertRow(tx, "payments", payment({ reference: "ch_dup", kind: "renewal" }))).rejects.toThrow(
        /duplicate key/,
      );
    });
  });

  it("doesn't let a creator mark their own payment paid or grant themselves a plan", async () => {
    await expect(
      asUser(db, A, (tx) => tx.query("update public.payments set status = 'succeeded' where user_id = $1", [A])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, A, (tx) => tx.query("update public.subscriptions set plan = 'pro' where user_id = $1", [A])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("Paystack-only migration", () => {
  let old: PGlite;

  beforeAll(async () => {
    old = await createTestDb({ before: PAYSTACK_ONLY });
    await insertRow(old, "users", { id: A });
    await insertRow(old, "users", { id: B });
    const end = new Date(Date.now() + 10 * DAY_MS).toISOString();
    // A: on an OPay pass. B: on Paystack.
    await insertRow(old, "subscriptions", {
      user_id: A,
      plan: "pro",
      status: "active",
      provider: "opay",
      current_period_end: end,
      cancel_at_period_end: true,
    });
    await insertRow(old, "payments", payment({ provider: "opay", kind: "pass", reference: "ch_pass", status: "succeeded" }));
    await insertRow(old, "subscriptions", {
      user_id: B,
      plan: "pro",
      status: "active",
      provider: "paystack",
      provider_subscription_id: "SUB_b",
      current_period_end: end,
    });
    await insertRow(old, "payments", payment({ user_id: B, reference: "ch_card", status: "succeeded" }));
    await applyMigration(old, PAYSTACK_ONLY);
  });

  afterAll(async () => {
    await old.close();
  });

  it("deletes OPay payments and keeps Paystack ones", async () => {
    const { rows } = await old.query<{ reference: string }>("select reference from public.payments order by reference");
    expect(rows.map((r) => r.reference)).toEqual(["ch_card"]);
  });

  it("puts OPay subscribers back on Free and leaves Paystack subscribers alone", async () => {
    const { rows } = await old.query<Record<string, unknown>>(
      `select user_id, plan, status, provider, current_period_end, cancel_at_period_end
       from public.subscriptions order by user_id`,
    );
    expect(rows[0]).toEqual({
      user_id: A,
      plan: "free",
      status: "active",
      provider: null,
      current_period_end: null,
      cancel_at_period_end: false,
    });
    expect(rows[1]).toMatchObject({ user_id: B, plan: "pro", status: "active", provider: "paystack" });
  });
});
