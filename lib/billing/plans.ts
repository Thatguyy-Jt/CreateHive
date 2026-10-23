import { z } from "zod";
import type { EnvSource } from "@/lib/ai/env";
import type { PaidPlan, SubscriptionPlan } from "@/lib/schemas/enums";

// The plans and their prices. What each plan includes lives in ./features.
// Read lazily, per call, so builds and tests run without billing variables.

export interface Plan {
  id: SubscriptionPlan;
  name: string;
  /** One line under the plan name. */
  tagline: string;
  /** Whole naira per month. 0 for Free. */
  priceNaira: number;
}

export type PlanCatalog = Record<SubscriptionPlan, Plan>;

export const PLAN_ORDER: readonly SubscriptionPlan[] = ["free", "pro"];

/** Overridable with `BILLING_PRICE_PRO_NGN`. */
export const DEFAULT_PRO_PRICE_NGN = 12_000;

const positiveInt = z.coerce.number().int().positive().max(10_000_000);

export interface PlanCatalogResult {
  plans: PlanCatalog;
  /** Names of variables that were set but invalid (their defaults were used). */
  invalid: string[];
}

export function readPlanCatalog(source: EnvSource = process.env): PlanCatalogResult {
  const invalid: string[] = [];
  let proPrice = DEFAULT_PRO_PRICE_NGN;
  const raw = source.BILLING_PRICE_PRO_NGN?.trim();
  if (raw) {
    const parsed = positiveInt.safeParse(raw);
    if (parsed.success) proPrice = parsed.data;
    else invalid.push("BILLING_PRICE_PRO_NGN");
  }

  return {
    plans: {
      free: { id: "free", name: "Free", tagline: "See the full loop work for your content.", priceNaira: 0 },
      pro: { id: "pro", name: "Pro", tagline: "For creators posting most days.", priceNaira: proPrice },
    },
    invalid,
  };
}

/** "₦12,000" */
export function formatNaira(naira: number): string {
  return `₦${Math.round(naira).toLocaleString("en-NG")}`;
}

/** Kobo for a whole-naira price. */
export const toKobo = (naira: number) => Math.round(naira * 100);

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface PaystackConfig {
  secretKey: string;
  planCodes: Record<PaidPlan, string>;
}

export interface BillingConfig {
  /** Origin used to build return and callback URLs. Never taken from the request. */
  appUrl: string | null;
  /** Null when its variables are missing: the UI shows it as not available. */
  paystack: PaystackConfig | null;
}

const nonEmpty = (value: string | undefined) => value?.trim() || null;

/** An absolute http(s) origin without a trailing slash; plain http only for localhost. */
function readOrigin(value: string | undefined): string | null {
  const raw = nonEmpty(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function readBillingConfig(source: EnvSource = process.env): BillingConfig {
  const paystackKey = nonEmpty(source.PAYSTACK_SECRET_KEY);
  const proCode = nonEmpty(source.PAYSTACK_PLAN_PRO);

  return {
    appUrl: readOrigin(source.APP_URL),
    paystack: paystackKey && proCode ? { secretKey: paystackKey, planCodes: { pro: proCode } } : null,
  };
}

/** Which paid plan a Paystack plan code belongs to, if any. */
export function planForPaystackCode(config: PaystackConfig, code: string | null | undefined): PaidPlan | null {
  if (!code) return null;
  return code === config.planCodes.pro ? "pro" : null;
}
