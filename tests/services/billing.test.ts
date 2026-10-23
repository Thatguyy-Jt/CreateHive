import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaystackClient, PaystackSubscription, PaystackTransaction } from "@/lib/billing/paystack";
import { readPlanCatalog, type BillingConfig } from "@/lib/billing/plans";
import {
  cancelPaystackSubscription,
  checkPayment,
  confirmReturn,
  coversUntil,
  getReceipt,
  listPaymentsForExport,
  handlePaystackEvent,
  resetPlanCache,
  startCheckout,
  type BillingDeps,
} from "@/lib/services/billing";
import { getAllowance } from "@/lib/billing/allowance";

const USER = "user_alice";
const OTHER = "user_bob";
const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

type Row = Record<string, unknown>;

/** In-memory stand-in for the two billing tables, honouring the filters the service uses. */
function memoryDb(seed: { subscriptions?: Row[]; payments?: Row[] } = {}, fail: { table?: string; op?: string } = {}) {
  const tables: Record<string, Row[]> = {
    subscriptions: (seed.subscriptions ?? []).map((r) => ({ ...r })),
    payments: (seed.payments ?? []).map((r) => ({ ...r })),
  };
  let nextId = 1;

  function query(table: string, op: string, payload?: Row, options?: { head?: boolean }) {
    const filters: [string, string, unknown][] = [];
    let single = false;
    const run = () => {
      if (fail.table === table && (!fail.op || fail.op === op)) return { data: null, error: { code: "XX000" }, count: null };
      const rows = tables[table];
      const match = (r: Row) =>
        filters.every(([kind, column, value]) =>
          kind === "eq" ? r[column] === value : kind === "gte" ? String(r[column]) >= String(value) : true,
        );
      if (op === "select") {
        const found = rows.filter(match);
        if (options?.head) return { data: null, error: null, count: found.length };
        return { data: single ? (found[0] ?? null) : found, error: null };
      }
      if (op === "insert") {
        const row: Row = {
          id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          created_at: new Date(NOW).toISOString(),
          status: "pending",
          applied_at: null,
          last_checked_at: null,
          ...payload,
        };
        if (table === "payments" && rows.some((r) => r.provider === row.provider && r.reference === row.reference)) {
          return { data: null, error: { code: "23505" } };
        }
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") {
        rows.filter(match).forEach((r) => Object.assign(r, payload));
        return { data: null, error: null };
      }
      // upsert on user_id
      const existing = rows.find((r) => r.user_id === payload!.user_id);
      if (existing) Object.assign(existing, payload);
      else rows.push({ cancel_at_period_end: false, provider_subscription_id: null, provider_email_token: null, ...payload });
      return { data: null, error: null };
    };
    const chain = {
      eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), chain),
      gte: (column: string, value: unknown) => (filters.push(["gte", column, value]), chain),
      order: () => chain,
      limit: () => chain,
      select: () => chain,
      maybeSingle: () => ((single = true), chain),
      single: () => ((single = true), chain),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  }

  const client = {
    from: (table: string) => ({
      select: (_columns?: string, options?: { head?: boolean }) => query(table, "select", undefined, options),
      insert: (payload: Row) => query(table, "insert", payload),
      update: (payload: Row) => query(table, "update", payload),
      upsert: (payload: Row) => query(table, "upsert", payload),
    }),
  };
  return { db: client as unknown as BillingDeps["db"], tables };
}

const subscription = (over: Partial<PaystackSubscription> = {}): PaystackSubscription => ({
  code: "SUB_new",
  status: "active",
  emailToken: "tok_new",
  planCode: "PLN_pro",
  customerCode: "CUS_1",
  nextPaymentDate: iso(30),
  createdAt: iso(0),
  card: null,
  ...over,
});

const transaction = (over: Partial<PaystackTransaction> = {}): PaystackTransaction => ({
  id: "991",
  status: "success",
  reference: "ch_pay",
  amountMinor: 1_200_000,
  currency: "NGN",
  customerId: "77",
  customerCode: "CUS_1",
  planCode: "PLN_pro",
  ...over,
});

function paystackFake(over: Partial<Record<keyof PaystackClient, unknown>> = {}) {
  return {
    initializeTransaction: vi.fn(async () => ({ ok: true, data: { authorizationUrl: "https://checkout.paystack.com/abc" } })),
    verifyTransaction: vi.fn(async () => ({ ok: true, data: transaction() })),
    fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription() })),
    listSubscriptions: vi.fn(async () => ({ ok: true, data: [subscription()] })),
    fetchPlan: vi.fn(async () => ({ ok: true, data: { amountMinor: 1_200_000, currency: "NGN" } })),
    disableSubscription: vi.fn(async () => ({ ok: true, data: null })),
    manageLink: vi.fn(async () => ({ ok: true, data: { link: "https://paystack.com/manage/x" } })),
    ...over,
  };
}

const CONFIG: BillingConfig = {
  appUrl: "https://app.test",
  paystack: { secretKey: "sk_test", planCodes: { pro: "PLN_pro" } },
};

function setup({
  subscriptions,
  payments,
  paystack = paystackFake(),
  config = CONFIG,
  fail,
}: {
  subscriptions?: Row[];
  payments?: Row[];
  paystack?: ReturnType<typeof paystackFake> | null;
  config?: BillingConfig;
  fail?: { table?: string; op?: string };
} = {}) {
  const memory = memoryDb({ subscriptions, payments }, fail);
  const deps: BillingDeps = {
    db: memory.db,
    config,
    plans: readPlanCatalog({}).plans,
    paystack: paystack as unknown as PaystackClient | null,
    now: () => NOW,
  };
  return { deps, ...memory, paystack: paystack! };
}

const pending = (over: Row = {}): Row => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: USER,
  provider: "paystack",
  kind: "subscription_start",
  plan: "pro",
  reference: "ch_pay",
  amount_minor: 1_200_000,
  currency: "NGN",
  status: "pending",
  applied_at: null,
  last_checked_at: null,
  created_at: iso(0),
  ...over,
});

const activeSub = (over: Row = {}): Row => ({
  user_id: USER,
  plan: "pro",
  status: "active",
  provider: "paystack",
  provider_customer_id: "CUS_1",
  provider_subscription_id: "SUB_old",
  provider_email_token: "tok_old",
  provider_plan_code: "PLN_pro",
  current_period_end: iso(10),
  cancel_at_period_end: false,
  ...over,
});

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPlanCache();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
  warnLog.mockRestore();
});

function logs() {
  return [...errorLog.mock.calls, ...warnLog.mock.calls].map((args) => args.map(String).join(" ")).join("\n");
}

// ---------------------------------------------------------------------------

describe("startCheckout", () => {
  const request = { userId: USER, email: "c@example.com", plan: "pro" as const };

  it("opens a Paystack plan checkout for the plan's price and records a pending payment", async () => {
    const { deps, tables, paystack } = setup();

    const result = await startCheckout(deps, request);

    expect(result).toEqual({ ok: true, url: "https://checkout.paystack.com/abc" });
    expect(tables.payments).toHaveLength(1);
    const payment = tables.payments[0];
    expect(payment).toMatchObject({ user_id: USER, provider: "paystack", kind: "subscription_start", plan: "pro", amount_minor: 1_200_000, status: "pending" });
    expect(payment.reference).toMatch(/^ch_[0-9a-f]{32}$/);
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "c@example.com",
        amountMinor: 1_200_000,
        planCode: "PLN_pro",
        reference: payment.reference,
        callbackUrl: `https://app.test/app/settings/billing/return?provider=paystack&reference=${payment.reference}`,
      }),
    );
  });

  it.each([
    ["Paystack isn't configured", { paystack: null, config: { ...CONFIG, paystack: null } }, "not_configured"],
    ["no APP_URL", { config: { ...CONFIG, appUrl: null } }, "not_configured"],
    ["an active subscription", { subscriptions: [activeSub()] }, "already_on_plan"],
  ] as const)("refuses %s", async (_label, options, code) => {
    const { deps, tables } = setup(options as Parameters<typeof setup>[0]);
    await expect(startCheckout(deps, request)).resolves.toEqual({ ok: false, code });
    expect(tables.payments).toHaveLength(0);
  });

  it("allows 5 checkouts an hour", async () => {
    const recent = Array.from({ length: 5 }, (_, i) => pending({ id: `p${i}`, reference: `ch_${i}`, status: "failed" }));
    const { deps, paystack } = setup({ payments: recent });
    await expect(startCheckout(deps, request)).resolves.toEqual({ ok: false, code: "too_many_attempts" });
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it("needs an email for Paystack", async () => {
    const { deps } = setup();
    await expect(startCheckout(deps, { ...request, email: null })).resolves.toEqual({
      ok: false,
      code: "missing_email",
    });
  });

  it("refuses to charge when the Paystack plan's price differs from the one shown", async () => {
    const paystack = paystackFake({ fetchPlan: vi.fn(async () => ({ ok: true, data: { amountMinor: 900_000, currency: "NGN" } })) });
    const { deps, tables } = setup({ paystack });
    await expect(startCheckout(deps, request)).resolves.toEqual({ ok: false, code: "price_mismatch" });
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
    expect(tables.payments).toHaveLength(0);
  });

  it("marks the payment failed when Paystack won't start a checkout", async () => {
    const paystack = paystackFake({ initializeTransaction: vi.fn(async () => ({ ok: false, code: "http_400", transient: false })) });
    const { deps, tables } = setup({ paystack });
    await expect(startCheckout(deps, request)).resolves.toEqual({ ok: false, code: "provider_error" });
    expect(tables.payments[0]).toMatchObject({ status: "failed", failure_reason: "http_400" });
  });
});

// ---------------------------------------------------------------------------

describe("Paystack events", () => {
  it("charge.success for our checkout: verifies, marks paid and syncs the new subscription", async () => {
    const { deps, tables, paystack } = setup({ payments: [pending()] });

    await expect(handlePaystackEvent(deps, { event: "charge.success", data: { reference: "ch_pay", amount: 1 } })).resolves.toEqual({
      status: 200,
    });

    expect(paystack.verifyTransaction).toHaveBeenCalledWith("ch_pay");
    expect(tables.payments[0]).toMatchObject({ status: "succeeded", provider_customer_id: "CUS_1", provider_order_id: "991" });
    expect(tables.subscriptions[0]).toMatchObject({
      user_id: USER,
      plan: "pro",
      status: "active",
      provider: "paystack",
      provider_subscription_id: "SUB_new",
      provider_email_token: "tok_new",
      current_period_end: iso(30),
      cancel_at_period_end: false,
    });
  });

  it("is idempotent: a replayed charge.success calls Paystack no further", async () => {
    const { deps, paystack } = setup({ payments: [pending()] });
    const event = { event: "charge.success", data: { reference: "ch_pay" } };
    await handlePaystackEvent(deps, event);
    await handlePaystackEvent(deps, event);
    expect(paystack.verifyTransaction).toHaveBeenCalledTimes(1);
  });

  it("grants the plan provisionally when the subscription doesn't exist yet", async () => {
    const paystack = paystackFake({ listSubscriptions: vi.fn(async () => ({ ok: true, data: [] })) });
    const { deps, tables } = setup({ payments: [pending()], paystack });
    await handlePaystackEvent(deps, { event: "charge.success", data: { reference: "ch_pay" } });
    expect(tables.subscriptions[0]).toMatchObject({ plan: "pro", status: "active", current_period_end: iso(30) });
  });

  it("fails the payment and grants nothing when the charged amount doesn't match", async () => {
    const paystack = paystackFake({ verifyTransaction: vi.fn(async () => ({ ok: true, data: transaction({ amountMinor: 100 }) })) });
    const { deps, tables } = setup({ payments: [pending()], paystack });
    await handlePaystackEvent(deps, { event: "charge.success", data: { reference: "ch_pay" } });
    expect(tables.payments[0]).toMatchObject({ status: "failed", failure_reason: "amount_mismatch" });
    expect(tables.subscriptions).toHaveLength(0);
    expect(logs()).toContain("billing_amount_mismatch");
  });

  it("never trusts the event payload: state comes from Paystack's API", async () => {
    const paystack = paystackFake({ fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old", status: "non-renewing", nextPaymentDate: null }) })) });
    const { deps, tables } = setup({ subscriptions: [activeSub()], paystack });

    await handlePaystackEvent(deps, {
      event: "subscription.not_renew",
      data: { subscription_code: "SUB_old", status: "active", plan: { plan_code: "PLN_forged" } },
    });

    expect(paystack.fetchSubscription).toHaveBeenCalledWith("SUB_old");
    expect(tables.subscriptions[0]).toMatchObject({
      plan: "pro",
      status: "active",
      cancel_at_period_end: true,
      current_period_end: iso(10),
    });
  });

  it.each([
    ["subscription.disable", { subscription_code: "SUB_old" }, "cancelled", "canceled"],
    ["invoice.payment_failed", { subscription: { subscription_code: "SUB_old" } }, "attention", "past_due"],
  ])("%s → %s", async (event, data, paystackStatus, status) => {
    const paystack = paystackFake({ fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old", status: paystackStatus }) })) });
    const { deps, tables } = setup({ subscriptions: [activeSub()], paystack });
    await expect(handlePaystackEvent(deps, { event, data })).resolves.toEqual({ status: 200 });
    expect(tables.subscriptions[0]).toMatchObject({ status, current_period_end: iso(10) });
  });

  it("asks Paystack to retry a subscription event for a customer we haven't matched yet", async () => {
    const { deps, tables } = setup();
    await expect(handlePaystackEvent(deps, { event: "subscription.create", data: { subscription_code: "SUB_new" } })).resolves.toEqual({
      status: 500,
    });
    expect(tables.subscriptions).toHaveLength(0);
  });

  it("matches a new customer through the first payment, then syncs", async () => {
    const { deps, tables } = setup({
      payments: [pending({ status: "succeeded", provider_customer_id: "CUS_1" })],
    });
    await expect(handlePaystackEvent(deps, { event: "subscription.create", data: { subscription_code: "SUB_new" } })).resolves.toEqual({
      status: 200,
    });
    expect(tables.subscriptions[0]).toMatchObject({ user_id: USER, provider_subscription_id: "SUB_new" });
  });

  it("a new subscription that replaces the current one disables the old one", async () => {
    const { deps, tables, paystack } = setup({ subscriptions: [activeSub()] });
    await handlePaystackEvent(deps, { event: "subscription.create", data: { subscription_code: "SUB_new" } });
    expect(paystack.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(tables.subscriptions[0]).toMatchObject({ plan: "pro", provider_subscription_id: "SUB_new" });
  });

  it("stores display-only card details from Paystack, keeping them when Paystack omits them", async () => {
    const card = { brand: "Visa", last4: "4081", exp: "09/28" };
    const withCard = paystackFake({ fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old", card }) })) });
    const first = setup({ subscriptions: [activeSub()], paystack: withCard });
    await handlePaystackEvent(first.deps, { event: "invoice.update", data: { subscription: { subscription_code: "SUB_old" } } });
    expect(first.tables.subscriptions[0]).toMatchObject({ card_brand: "Visa", card_last4: "4081", card_exp: "09/28" });

    const without = paystackFake({ fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old" }) })) });
    const second = setup({ subscriptions: [activeSub({ card_brand: "Visa", card_last4: "4081" })], paystack: without });
    await handlePaystackEvent(second.deps, { event: "invoice.update", data: { subscription: { subscription_code: "SUB_old" } } });
    expect(second.tables.subscriptions[0]).toMatchObject({ card_brand: "Visa", card_last4: "4081" });
  });

  it("ignores the old subscription's disable event after an upgrade", async () => {
    const paystack = paystackFake({ fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old", status: "cancelled" }) })) });
    const { deps, tables } = setup({ subscriptions: [activeSub({ provider_subscription_id: "SUB_new" })], paystack });
    await handlePaystackEvent(deps, { event: "subscription.disable", data: { subscription_code: "SUB_old" } });
    expect(tables.subscriptions[0]).toMatchObject({ plan: "pro", status: "active", provider_subscription_id: "SUB_new" });
  });

  it("records a monthly renewal once and moves the period forward", async () => {
    const paystack = paystackFake({
      verifyTransaction: vi.fn(async () => ({ ok: true, data: transaction({ reference: "T_renew_1" }) })),
      fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old", nextPaymentDate: iso(40) }) })),
    });
    const { deps, tables } = setup({ subscriptions: [activeSub()], paystack });
    const event = { event: "charge.success", data: { reference: "T_renew_1" } };

    await expect(handlePaystackEvent(deps, event)).resolves.toEqual({ status: 200 });
    await expect(handlePaystackEvent(deps, event)).resolves.toEqual({ status: 200 });

    expect(tables.payments).toHaveLength(1);
    expect(tables.payments[0]).toMatchObject({ kind: "renewal", reference: "T_renew_1", status: "succeeded", user_id: USER });
    expect(tables.subscriptions[0].current_period_end).toBe(iso(40));
  });

  it("ignores charges for plans that aren't ours", async () => {
    const paystack = paystackFake({ verifyTransaction: vi.fn(async () => ({ ok: true, data: transaction({ reference: "T_x", planCode: null }) })) });
    const { deps, tables } = setup({ paystack });
    await expect(handlePaystackEvent(deps, { event: "charge.success", data: { reference: "T_x" } })).resolves.toEqual({ status: 200 });
    expect(tables.payments).toHaveLength(0);
  });

  it("acknowledges events it doesn't handle", async () => {
    const { deps, paystack } = setup();
    await expect(handlePaystackEvent(deps, { event: "transfer.success", data: {} })).resolves.toEqual({ status: 200 });
    expect(paystack.fetchSubscription).not.toHaveBeenCalled();
  });

  it("asks for a retry when the database fails", async () => {
    const { deps } = setup({ payments: [pending()], fail: { table: "payments", op: "select" } });
    await expect(handlePaystackEvent(deps, { event: "charge.success", data: { reference: "ch_pay" } })).resolves.toEqual({ status: 500 });
  });
});

// ---------------------------------------------------------------------------

describe("creator actions", () => {
  it("the return page only confirms the signed-in creator's own payment", async () => {
    const { deps, paystack } = setup({ payments: [pending()] });
    await expect(confirmReturn(deps, OTHER, "paystack", "ch_pay")).resolves.toEqual({ ok: false, code: "not_found" });
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    await expect(confirmReturn(deps, USER, "paystack", "ch_pay")).resolves.toEqual({ ok: true, status: "succeeded" });
  });

  it("the return page reports pending, not an error, when the provider is unreachable", async () => {
    const paystack = paystackFake({ verifyTransaction: vi.fn(async () => ({ ok: false, code: "network", transient: true })) });
    const { deps } = setup({ payments: [pending()], paystack });
    await expect(confirmReturn(deps, USER, "paystack", "ch_pay")).resolves.toEqual({ ok: true, status: "pending" });
  });

  it("Check status waits 30 seconds between checks", async () => {
    const { deps, paystack } = setup({ payments: [pending({ last_checked_at: new Date(NOW - 10_000).toISOString() })] });
    await expect(checkPayment(deps, USER, "11111111-1111-4111-8111-111111111111")).resolves.toEqual({ ok: false, code: "too_soon" });
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    await expect(checkPayment(deps, OTHER, "11111111-1111-4111-8111-111111111111")).resolves.toEqual({ ok: false, code: "not_found" });
  });

  it("cancelling disables the Paystack subscription and keeps access to the period end", async () => {
    const paystack = paystackFake({
      fetchSubscription: vi.fn(async () => ({ ok: true, data: subscription({ code: "SUB_old", status: "non-renewing", nextPaymentDate: iso(10) }) })),
    });
    const { deps, tables } = setup({ subscriptions: [activeSub()], paystack });

    await expect(cancelPaystackSubscription(deps, USER)).resolves.toEqual({ ok: true });
    expect(paystack.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(tables.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: true, current_period_end: iso(10) });
  });

  it("cancelling without a Paystack subscription has nothing to manage", async () => {
    const { deps } = setup();
    await expect(cancelPaystackSubscription(deps, USER)).resolves.toEqual({ ok: false, code: "nothing_to_manage" });
  });

  it("never logs creator ids, emails or references", async () => {
    const paystack = paystackFake({ verifyTransaction: vi.fn(async () => ({ ok: true, data: transaction({ amountMinor: 1 }) })) });
    const { deps } = setup({ payments: [pending()], paystack });
    await handlePaystackEvent(deps, { event: "charge.success", data: { reference: "ch_pay" } });
    await startCheckout(setup({ paystack: paystackFake({ fetchPlan: vi.fn(async () => ({ ok: false, code: "http_500", transient: true })) }) }).deps, {
      userId: USER,
      email: "c@example.com",
      plan: "pro",
    });
    const output = logs();
    expect(output).not.toContain(USER);
    expect(output).not.toContain("c@example.com");
    expect(output).not.toContain("ch_pay");
  });
});

// ---------------------------------------------------------------------------

describe("getAllowance", () => {
  it("gives Pro while the subscription is active", async () => {
    const { db } = memoryDb({ subscriptions: [activeSub()] });
    await expect(getAllowance(db, USER, NOW, {})).resolves.toMatchObject({ plan: { id: "pro" }, entitlement: { paid: true } });
  });

  it("drops to Free when the period has ended", async () => {
    const { db } = memoryDb({ subscriptions: [activeSub({ current_period_end: iso(-1) })] });
    await expect(getAllowance(db, USER, NOW, {})).resolves.toMatchObject({ plan: { id: "free" } });
  });

  it("falls back to Free (never open) when the subscription can't be read", async () => {
    const { db } = memoryDb({ subscriptions: [activeSub()] }, { table: "subscriptions" });
    await expect(getAllowance(db, USER, NOW, {})).resolves.toMatchObject({ plan: { id: "free" } });
    expect(logs()).toContain("billing_entitlement_read_failed");
  });
});

// ---------------------------------------------------------------------------

describe("receipts and export", () => {
  const paid = (over: Row = {}) => pending({ status: "succeeded", applied_at: iso(0), provider_order_id: "2110", ...over });

  it("a charge covers one calendar month", () => {
    expect(coversUntil("2026-10-21T12:00:00.000Z")).toBe("2026-11-21T12:00:00.000Z");
    expect(coversUntil("2026-01-31T12:00:00.000Z")).toBe("2026-03-03T12:00:00.000Z");
    expect(coversUntil(null)).toBeNull();
  });

  it("gives the owner a receipt for a paid payment, with a short receipt number", async () => {
    const { db } = memoryDb({ payments: [paid()] });
    const result = await getReceipt(db, USER, "11111111-1111-4111-8111-111111111111", NOW);
    expect(result).toMatchObject({
      ok: true,
      receipt: { number: "11111111", plan: "pro", amountMinor: 1_200_000, providerReference: "2110", coversUntil: iso(31) },
    });
  });

  it("has no receipt for another creator's payment or an unpaid one", async () => {
    const { db } = memoryDb({ payments: [paid(), pending({ id: "22222222-2222-4222-8222-222222222222", reference: "ch_2" })] });
    await expect(getReceipt(db, OTHER, "11111111-1111-4111-8111-111111111111", NOW)).resolves.toEqual({ ok: true, receipt: null });
    await expect(getReceipt(db, USER, "22222222-2222-4222-8222-222222222222", NOW)).resolves.toEqual({ ok: true, receipt: null });
  });

  it("exports only the creator's own payments, with expired pending ones marked", async () => {
    const { db } = memoryDb({
      payments: [
        paid(),
        pending({ id: "p2", reference: "ch_2", created_at: iso(-2) }),
        paid({ id: "p3", reference: "ch_3", user_id: OTHER }),
      ],
    });
    const result = await listPaymentsForExport(db, USER, NOW);
    expect(result.ok && result.payments.map((p) => p.status)).toEqual(["succeeded", "expired"]);
  });
});
