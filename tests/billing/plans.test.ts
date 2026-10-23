import { describe, expect, it } from "vitest";
import { checkoutDecision, endsSoon, FREE, resolveEntitlement, type SubscriptionState } from "@/lib/billing/entitlement";
import { checkoutOptions } from "@/lib/billing/plan-options";
import { formatNaira, planForPaystackCode, readBillingConfig, readPlanCatalog, toKobo } from "@/lib/billing/plans";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const row = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  plan: "pro",
  status: "active",
  provider: "paystack",
  current_period_end: iso(10),
  cancel_at_period_end: false,
  ...over,
});

describe("readPlanCatalog", () => {
  it("has Free and Pro, with Pro at ₦12,000", () => {
    const { plans, invalid } = readPlanCatalog({});
    expect(invalid).toEqual([]);
    expect(Object.keys(plans)).toEqual(["free", "pro"]);
    expect(plans.free).toMatchObject({ name: "Free", priceNaira: 0 });
    expect(plans.pro).toMatchObject({ name: "Pro", priceNaira: 12_000 });
  });

  it("takes the Pro price from env, falling back to the default for invalid values", () => {
    expect(readPlanCatalog({ BILLING_PRICE_PRO_NGN: "15000" }).plans.pro.priceNaira).toBe(15_000);
    const invalid = readPlanCatalog({ BILLING_PRICE_PRO_NGN: "-1" });
    expect(invalid.plans.pro.priceNaira).toBe(12_000);
    expect(invalid.invalid).toEqual(["BILLING_PRICE_PRO_NGN"]);
  });

  it("formats naira and converts to kobo", () => {
    expect(formatNaira(12_000)).toBe("₦12,000");
    expect(toKobo(12_000)).toBe(1_200_000);
  });
});

describe("readBillingConfig", () => {
  const full = {
    APP_URL: "https://createhive.app/",
    PAYSTACK_SECRET_KEY: "sk_test",
    PAYSTACK_PLAN_PRO: "PLN_pro",
  };

  it("enables Paystack only when all its variables are set", () => {
    const config = readBillingConfig(full);
    expect(config.appUrl).toBe("https://createhive.app");
    expect(config.paystack?.planCodes).toEqual({ pro: "PLN_pro" });

    expect(readBillingConfig({ ...full, PAYSTACK_PLAN_PRO: " " }).paystack).toBeNull();
    expect(readBillingConfig({ ...full, PAYSTACK_SECRET_KEY: undefined }).paystack).toBeNull();
  });

  it("only accepts https app URLs (http for localhost)", () => {
    expect(readBillingConfig({ APP_URL: "http://createhive.app" }).appUrl).toBeNull();
    expect(readBillingConfig({ APP_URL: "not a url" }).appUrl).toBeNull();
    expect(readBillingConfig({ APP_URL: "http://localhost:3000" }).appUrl).toBe("http://localhost:3000");
  });

  it("maps Paystack plan codes back to plans", () => {
    const paystack = readBillingConfig(full).paystack!;
    expect(planForPaystackCode(paystack, "PLN_pro")).toBe("pro");
    expect(planForPaystackCode(paystack, "PLN_other")).toBeNull();
    expect(planForPaystackCode(paystack, null)).toBeNull();
  });
});

describe("resolveEntitlement", () => {
  it.each<[string, SubscriptionState | null, string]>([
    ["no row", null, "free"],
    ["a free row", row({ plan: "free", provider: null }), "free"],
    ["an active subscription", row(), "pro"],
    ["a non-renewing subscription before its end", row({ cancel_at_period_end: true }), "pro"],
    ["a non-renewing subscription after its end", row({ cancel_at_period_end: true, current_period_end: iso(-1) }), "free"],
    ["past_due before the period ends", row({ status: "past_due" }), "pro"],
    ["past_due after the period ends", row({ status: "past_due", current_period_end: iso(-1) }), "free"],
    ["canceled with time left", row({ status: "canceled", cancel_at_period_end: true }), "free"],
    ["a retired provider", row({ provider: "opay" }), "free"],
    ["a retired plan", row({ plan: "studio" }), "free"],
    ["incomplete", row({ status: "incomplete" }), "free"],
  ])("%s → %s", (_label, input, plan) => {
    expect(resolveEntitlement(input, NOW).plan).toBe(plan);
  });

  it("only says a plan renews for an active, non-cancelled subscription", () => {
    expect(resolveEntitlement(row(), NOW).renews).toBe(true);
    expect(resolveEntitlement(row({ cancel_at_period_end: true }), NOW).renews).toBe(false);
    expect(resolveEntitlement(row({ status: "past_due" }), NOW).renews).toBe(false);
  });

  it("warns when a cancelled plan ends within 5 days", () => {
    expect(endsSoon(resolveEntitlement(row({ cancel_at_period_end: true, current_period_end: iso(4) }), NOW), NOW)).toBe(true);
    expect(endsSoon(resolveEntitlement(row({ cancel_at_period_end: true, current_period_end: iso(6) }), NOW), NOW)).toBe(false);
    expect(endsSoon(resolveEntitlement(row({ current_period_end: iso(2) }), NOW), NOW)).toBe(false); // renews
    expect(endsSoon(FREE, NOW)).toBe(false);
  });
});

describe("checkoutDecision", () => {
  it("allows checkout from Free and refuses a second subscription", () => {
    expect(checkoutDecision(FREE)).toEqual({ allowed: true });
    expect(checkoutDecision(resolveEntitlement(row(), NOW))).toEqual({ allowed: false, code: "already_on_plan" });
  });
});

describe("checkoutOptions", () => {
  it("offers one card option from Free", () => {
    const options = checkoutOptions(FREE, "pro", true);
    expect(options.map((o) => [o.provider, o.label, o.blocked])).toEqual([["paystack", "Upgrade with card", null]]);
  });

  it("labels it unavailable when Paystack isn't configured, and blocked while on Pro", () => {
    expect(checkoutOptions(FREE, "pro", false)[0].blocked).toBe("Not available yet");
    expect(checkoutOptions(resolveEntitlement(row(), NOW), "pro", true)[0].blocked).toBe(
      "Available again when your current period ends",
    );
  });
});
